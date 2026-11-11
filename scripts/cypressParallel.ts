// Runs the Cypress component specs in parallel, split across workers by cypress-split.
//
// Usage:
//   npm run cy:par                                   all specs, the thread count in package.json
//   npm run cy:par -- --spec "src/x/Foo.cy.ts"       specific spec(s)
//   node scripts/cypressParallel.ts -t 4             another thread count
//
// Timing data is stored in cypress/timingsWithOverhead.json (ignored) and used by cypress-split to
// balance specs across workers on later runs. Each duration is inflated by a per-spec overhead
// estimate (~2s boot/compile/teardown, measured at 2 threads) so that cypress-split doesn't stack
// many small specs on one worker.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

interface Durations {
  durations: Array<{ spec: string; duration: number }>
}

/** The parts of Cypress's `after:run` results this script reads. */
interface RunResults {
  totalTests: number
  totalPassed: number
  totalFailed: number
  totalPending: number
  totalSkipped: number
  runs?: Array<{
    spec?: { relative?: string; name?: string }
    stats?: { duration: number; failures: number }
    tests?: Array<{ state: string; title: string[]; displayError?: string | null }>
  }>
}

interface WorkerResult {
  code: number
  duration: number
  /** Spawn to the first `Running:` line; Chrome's launch falls in the first spec. */
  startupMs: number | null
  /** Per spec: `Running:` line to its `after:spec`, minus its in-browser test time. */
  overheadsMs: number[]
  specsRun: string[]
  killed: boolean
  outputBuffer: string[]
}

const scriptStart = Date.now()
const isWindows = process.platform === 'win32'

const OWN_OPTIONS = {
  threads: { type: 'string', short: 't' },
  spec: { type: 'string', short: 's' },
} as const
const { values, tokens } = parseArgs({
  args: process.argv.slice(2),
  options: OWN_OPTIONS,
  strict: false,
  tokens: true,
})

// Our own flags aren't forwarded to Cypress. `--spec` goes to cypress-split as SPEC instead:
// cypress-split splits only what SPEC lists, while Cypress given `--spec` runs the part of it in
// each worker's chunk of the whole suite, and a worker whose chunk holds none of it fails with "no
// spec files were found".
const ownTokenIndices = new Set(
  tokens.flatMap((t) => {
    if (t.kind !== 'option' || !Object.hasOwn(OWN_OPTIONS, t.name)) return []
    // inlineValue distinguishes --threads 5 (two argv entries) from --threads=5 (one entry).
    return t.inlineValue === false ? [t.index, t.index + 1] : [t.index]
  }),
)
const cypressExtraArgs = process.argv.slice(2).filter((_, i) => !ownTokenIndices.has(i))

const threads = Number(values.threads)
if (!Number.isInteger(threads) || threads < 1) {
  console.error(
    `Invalid thread count. Use a positive integer via --threads <n> or -t <n>. Received: "${values.threads}".`,
  )
  process.exit(1)
}

const specArg = typeof values.spec === 'string' ? values.spec : undefined
const specList =
  specArg
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []

// Cap threads to explicit spec count: cypress-split gives an empty chunk a placeholder spec, so an
// extra worker would boot Cypress and Chrome for nothing.
const hasGlob = specList.some((s) => /[*?[\]{}]/.test(s))

let effectiveThreads = threads
if (specList.length > 0 && !hasGlob && threads > specList.length) {
  effectiveThreads = specList.length
  console.warn(`Capped threads from ${threads} to ${specList.length} (explicit spec count).`)
}

// Machine-local, ignored paths for timing-based spec distribution.
const TIMINGS_FILE = 'cypress/timingsWithOverhead.json'
const workerResultsFile = (i: number): string => `cypress/.results-worker-${i}.json`

/** Per-spec overhead added to stored durations (see file header for rationale). */
const SPEC_OVERHEAD_MS = 2000
const timingsExist = fs.existsSync(TIMINGS_FILE)
// Each worker gets an isolated Vite dep-optimization cache to avoid parallel write races
// that corrupt module loads on cold starts. "warm" = all cache dirs exist from a prior run.
const viteCacheDir = (i: number): string => `node_modules/.vite-cypress-worker-${i}`
const viteCache = Array.from({ length: effectiveThreads }, (_, i) => viteCacheDir(i)).every((d) =>
  fs.existsSync(d),
)
  ? 'warm'
  : 'cold'

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

console.log(
  `[cypress-parallel] threads=${effectiveThreads}${specList.length > 0 ? ` specs=${specList.length}` : ''}${timingsExist ? ` (timing-balanced, +${seconds(SPEC_OVERHEAD_MS)} overhead/spec)` : ''} (vite cache: ${viteCache})`,
)

// Spawned directly rather than through `npm run cy:run`: Node refuses to spawn a `.cmd` shim
// without a shell, and the script's `set ELECTRON_RUN_AS_NODE=&&` is a cmd-ism done below instead.
// Beside its package.json: Cypress exports no path to its CLI.
const require = createRequire(import.meta.url)
const CYPRESS_BIN = path.join(path.dirname(require.resolve('cypress/package.json')), 'bin/cypress')
const CYPRESS_ARGS = ['run', '--component', '--browser=chrome']

let firstRunningLine = true

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;]*m/g
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '')
}

function runWorker(splitIndex: number) {
  const specsRun: string[] = []
  const outputBuffer: string[] = []
  const start = Date.now()
  let startupMs: number | null = null
  let specStartedAt = 0
  const overheadsMs: number[] = []

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '1',
    CYPRESS_trashAssetsBeforeRuns: process.env.CYPRESS_trashAssetsBeforeRuns ?? 'false',
    // Isolated per-worker Vite cache to avoid parallel write races.
    VITE_CACHE_DIR: viteCacheDir(splitIndex),
    // cypress-split env vars for work distribution.
    SPLIT: String(effectiveThreads),
    SPLIT_INDEX: String(splitIndex),
    SPLIT_FILE: TIMINGS_FILE,
    SPLIT_OUTPUT_FILE: os.devNull, // Unset, it writes over SPLIT_FILE; timings come from results
    ...(specArg ? { SPEC: specArg } : {}),
    // Structured results for the end-of-run report.
    CY_PARALLEL_RESULTS_FILE: workerResultsFile(splitIndex),
  }
  // Set by Electron hosts such as VS Code; Cypress is Electron, and would start as plain Node.
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(process.execPath, [CYPRESS_BIN, ...CYPRESS_ARGS, ...cypressExtraArgs], {
    env,
    stdio: ['inherit', 'pipe', 'pipe'], // output piped for the live lines and the raw dumps
    detached: !isWindows, // a process group for kill() on POSIX; on Windows, a console window
    windowsHide: true,
  })
  let killed = false

  // Buffer all output; print chunk table + "Running:" lines live for progress visibility.
  const prefix = `Worker ${splitIndex + 1} `
  let stdoutRemainder = ''
  child.stdout.on('data', (chunk: Buffer) => {
    const text = stdoutRemainder + chunk.toString()
    const lines = text.split('\n')
    stdoutRemainder = lines.pop() ?? '' // keep incomplete last line for next chunk
    for (const line of lines) {
      outputBuffer.push(line)

      const plain = stripAnsi(line)
      const matchRunning = plain.match(/Running:\s+(\S+\.cy\.\w+)/) // .js: cypress-split's placeholder
      const matchDone = plain.match(/\[cy-par\] spec-done (\d+)/) // written by cypress.config.ts
      if (matchRunning) {
        specStartedAt = Date.now()
        startupMs ??= specStartedAt - start
        specsRun.push(matchRunning[1])
        if (firstRunningLine) {
          firstRunningLine = false
          process.stdout.write('\n')
        }
        process.stdout.write(`${prefix}${line}\n`)
      } else if (matchDone) {
        const wallMs = Date.now() - specStartedAt
        const testsMs = Number(matchDone[1])
        overheadsMs.push(wallMs - testsMs)
        process.stdout.write(
          `${prefix}  Done:    ${specsRun.at(-1)}  ${seconds(wallMs)} = tests ${seconds(testsMs)} + overhead ${seconds(wallMs - testsMs)}\n`,
        )
      } else if (/^k\s+spec/.test(plain)) {
        // cypress-split chunk table: header row
        process.stdout.write(`\n${prefix}\n${line}\n`)
      } else if (/^-\s+-|^\d+\s+src[\\/]/.test(plain)) {
        // cypress-split chunk table: separator or spec row (backslashes on Windows)
        process.stdout.write(`${line}\n`)
      }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n')
    for (const line of lines) {
      if (line) outputBuffer.push(line)
    }
  })

  const result = (code: number): WorkerResult => ({
    code,
    duration: Date.now() - start,
    startupMs,
    overheadsMs,
    specsRun,
    killed,
    outputBuffer,
  })
  let settle: (result: WorkerResult) => void = () => {}
  const promise = new Promise<WorkerResult>((resolve) => {
    settle = resolve
    child.on('close', (code) => resolve(result(code ?? 1)))
    child.on('error', () => resolve(result(1)))
  })

  /** Kills the whole tree (Cypress, its server, Chrome) and settles now, not on `close`. */
  function kill(): void {
    killed = true
    if (child.pid !== undefined) {
      if (isWindows) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL') // negative pid: the detached process group
        } catch {
          /* already exited */
        }
      }
    }
    settle(result(1))
  }

  return { promise, kill }
}

// Launch all workers, apply straggler timeout if one outlasts the rest.
const STRAGGLER_TIMEOUT_MS = 30_000
const workers = Array.from({ length: effectiveThreads }, (_, i) => runWorker(i))
const workerResults: Array<WorkerResult | null> = Array.from(
  { length: effectiveThreads },
  () => null,
)
let settledCount = 0

await Promise.all(
  workers.map((w, i) =>
    w.promise.then((result) => {
      workerResults[i] = result
      settledCount++
      // When all but one worker is done, start straggler timeout for remaining
      if (settledCount === effectiveThreads - 1) {
        const stragglerIdx = workerResults.findIndex((s) => s === null)
        setTimeout(() => {
          if (workerResults[stragglerIdx] !== null) return
          console.error(
            `\n[cypress-parallel] Worker ${stragglerIdx + 1} exceeded straggler timeout (${STRAGGLER_TIMEOUT_MS / 1000}s after others finished). Killing...`,
          )
          workers[stragglerIdx].kill()
        }, STRAGGLER_TIMEOUT_MS)
      }
    }),
  ),
)

function loadJSON<T>(path: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

const workerRunResults = Array.from({ length: effectiveThreads }, (_, i) =>
  loadJSON<RunResults>(workerResultsFile(i)),
)

// Merge per-worker timings into the shared file; preserves timings for specs not in this run.
const existingTimings = (timingsExist ? loadJSON<Durations>(TIMINGS_FILE) : null) ?? {
  durations: [],
}
const storedDurations = new Map(existingTimings.durations.map((e) => [e.spec, e.duration]))

const durationMap = new Map(storedDurations)
for (const run of workerRunResults.flatMap((rr) => rr?.runs ?? [])) {
  // A failed spec stopped early or waited out timeouts, so it keeps its stored timing.
  if (!run.spec?.relative || !run.stats || run.stats.failures > 0) continue
  durationMap.set(run.spec.relative, run.stats.duration + SPEC_OVERHEAD_MS)
}

const terminalWidth = Number(process.stdout.columns ?? process.env.COLUMNS)
const separatorWidth =
  Number.isFinite(terminalWidth) && terminalWidth > 0 ? Math.min(terminalWidth - 2, 140) : 80
const SEPARATOR = '─'.repeat(separatorWidth)
const ICON_PASS = '✔'
const ICON_FAIL = '✖'
const ICON_WARN = '⚠'
const ICON_ARROW = '→'

if (durationMap.size > 0) {
  const merged: Durations = {
    durations: Array.from(durationMap, ([spec, duration]) => ({ spec, duration })),
  }
  fs.writeFileSync(TIMINGS_FILE, `${JSON.stringify(merged, null, 2)}\n`)
  console.log(
    `\n[cypress-parallel] timings updated ${ICON_ARROW} ${TIMINGS_FILE} (${durationMap.size} specs)`,
  )
}

function failuresIn(runResult: RunResults | null) {
  return (runResult?.runs ?? []).flatMap((run) =>
    (run.tests ?? [])
      .filter((test) => test.state === 'failed')
      .map((test) => ({
        spec: run.spec?.relative ?? run.spec?.name ?? '(unknown)',
        test: test.title.join(' > '),
        error: (test.displayError ?? '').split('\n')[0],
      })),
  )
}

/** Per-worker results and timing predictions; falls back to live specsRun for crashed workers. */
const perWorker = workerRunResults.map((rr, i) => {
  // Every worker has settled, or been force-resolved, by now.
  const result = workerResults[i] as WorkerResult

  const resultSpecs =
    rr?.runs
      ?.map((run) => run.spec?.relative ?? run.spec?.name)
      .filter((s): s is string => Boolean(s)) ?? []
  const specSources = resultSpecs.length > 0 ? resultSpecs : result.specsRun
  let expectedMs = 0
  let untimedSpecs = 0
  for (const spec of specSources) {
    const inflated = storedDurations.get(spec)
    if (typeof inflated === 'number') expectedMs += inflated
    else untimedSpecs++
  }

  return { index: i, ...result, results: rr, failures: failuresIn(rr), expectedMs, untimedSpecs }
})
const failedWorkers = perWorker.filter((w) => w.code !== 0)
const suspiciousWorkers = perWorker.filter((w) => w.code === 0 && !w.results && !w.killed)

// #region Terminal report — raw dumps, failures, per-worker summary, totals
// Dump full buffered output for crashed/killed workers.
const problemWorkers = perWorker.filter((w) => w.killed || !w.results)
for (const w of problemWorkers) {
  if (w.outputBuffer.length > 0) {
    const label = w.killed
      ? 'Killed (straggler)'
      : w.code !== 0
        ? 'Crashed'
        : 'Suspicious (exit 0, no results)'
    console.log(`\n${SEPARATOR}`)
    console.log(` Raw output: Worker ${w.index + 1} — ${label}`)
    console.log(SEPARATOR)
    for (const line of w.outputBuffer) {
      console.log(line)
    }
    // Reset ANSI colors in case Cypress output left a style open (dim/gray bleed)
    process.stdout.write('\x1B[0m')
    console.log(SEPARATOR)
  }
}

if (perWorker.some((w) => w.failures.length > 0)) {
  console.log(`\n${SEPARATOR}`)
  console.log(' [cypress-parallel] Failed Tests')
  console.log(SEPARATOR)
  for (const worker of perWorker) {
    for (const { spec, test, error } of worker.failures) {
      const specName = path.basename(spec)
      console.log(` ${ICON_FAIL}  ${specName} ${ICON_ARROW} ${test}`)
      if (error) console.log(`      ${error}`)
      console.log('')
    }
  }
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

console.log(`\n${SEPARATOR}`)
console.log(' [cypress-parallel] Run Summary')
console.log(SEPARATOR)

for (const w of perWorker) {
  const lastSpec = w.specsRun.at(-1) ?? ''
  const dimSpec = lastSpec ? `\x1B[2m${lastSpec}\x1B[22m` : ''
  let mark: string
  let suffix: string

  if (w.killed) {
    mark = ICON_WARN
    suffix = ` (killed: straggler${dimSpec ? ` — last run spec: ${dimSpec}` : ''})`
  } else if (w.code !== 0) {
    mark = w.results ? ICON_FAIL : ICON_WARN
    suffix = w.results ? '' : ` (crashed${dimSpec ? ` — last run spec: ${dimSpec}` : ''})`
  } else if (!w.results) {
    mark = ICON_WARN
    suffix = ` (no results${dimSpec ? ` — last run spec: ${dimSpec}` : ''})`
  } else {
    mark = ICON_PASS
    suffix = ''
  }

  const r = w.results
  const counts = r
    ? `  ${r.runs?.length ?? 0} specs  ${r.totalTests} tests, ${r.totalPassed} passed${r.totalFailed ? `, ${r.totalFailed} FAILED` : ''}`
    : ''
  console.log(` ${mark}  worker ${w.index + 1}${counts}${suffix}`)

  // Startup is measured, not predicted, so the prediction is set against the specs alone.
  let time = seconds(w.duration)
  if (w.startupMs !== null) {
    const specsMs = w.duration - w.startupMs
    time += ` = startup ${seconds(w.startupMs)} + specs ${seconds(specsMs)}`
    if (w.expectedMs > 0) {
      const percent = Math.round(((specsMs - w.expectedMs) / w.expectedMs) * 100)
      const sign = percent >= 0 ? '+' : ''
      const untimed = w.untimedSpecs ? `, ${w.untimedSpecs} specs untimed` : ''
      time += ` (predicted ${seconds(w.expectedMs)}, ${sign}${percent}%${untimed})`
    }
  }
  console.log(`     ${time}`)
  // The first spec's overhead holds Chrome's launch, so it's kept out of the median.
  const [firstOverhead, ...laterOverheads] = w.overheadsMs
  if (firstOverhead !== undefined) {
    const later = laterOverheads.length ? `, then median ${seconds(median(laterOverheads))}` : ''
    console.log(
      `     overhead: first spec ${seconds(firstOverhead)}${later} (stored timings add ${seconds(SPEC_OVERHEAD_MS)})`,
    )
  }
  console.log('')
}

const totals = perWorker.reduce(
  (acc, { results }) => {
    acc.specs += results?.runs?.length ?? 0
    acc.tests += results?.totalTests ?? 0
    acc.passed += results?.totalPassed ?? 0
    acc.failed += results?.totalFailed ?? 0
    acc.pending += results?.totalPending ?? 0
    acc.skipped += results?.totalSkipped ?? 0
    return acc
  },
  { specs: 0, tests: 0, passed: 0, failed: 0, pending: 0, skipped: 0 },
)
const totalParts = [
  `${totals.specs} specs`,
  `${totals.tests} tests`,
  `${totals.passed} passed`,
  `${totals.failed} failed`,
  ...(totals.pending ? [`${totals.pending} pending`] : []),
  ...(totals.skipped ? [`${totals.skipped} skipped`] : []),
]
console.log(` Totals:  ${totalParts.join('  |  ')}`)
console.log(` Total run time: ${seconds(Date.now() - scriptStart)}`)
console.log(SEPARATOR)
// #endregion

// Clean up per-worker temp files.
for (let i = 0; i < effectiveThreads; i++) {
  fs.rmSync(workerResultsFile(i), { force: true })
}

process.exit(failedWorkers.length > 0 || suspiciousWorkers.length > 0 ? 1 : 0)
