/**
 * Drives the running app for a manual check: starts Vite, runs a flow module in the project's
 * Playwright Chromium, then stops both. The flow default-exports `async ({ page, shot }) => …`;
 * `page` starts at `/`, and `shot(name)` saves a full-page screenshot and prints its path.
 * Screenshots go to the OS temp directory unless given a directory as the second argument. Console
 * errors and uncaught page errors print at the end and fail the run.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, type Page } from 'playwright'

type Flow = (context: { page: Page; shot: (name: string) => Promise<void> }) => Promise<void>

// Clear of 5173, where a plain `npm run dev` starts, and 5199, Cypress's dev server.
const port = 5188
const baseURL = `http://localhost:${port}/`

const [flowPath, outArg] = process.argv.slice(2)
if (!flowPath) throw new Error('usage: npm run drive -- <flow.ts> [outDir]')
const outDir = outArg ?? join(tmpdir(), 'chronicle-drive')
const flow = ((await import(pathToFileURL(resolve(flowPath)).href)) as { default: Flow }).default

/** Resolves once Vite answers; throws if it exits first, which `--strictPort` does on a taken port. */
async function waitForServer(server: ChildProcess) {
  while (server.exitCode === null) {
    try {
      await fetch(baseURL)
      return
    } catch {
      await new Promise((settle) => setTimeout(settle, 200))
    }
  }
  throw new Error(`Vite exited before answering; is something else listening on ${port}?`)
}

mkdirSync(outDir, { recursive: true })
// Vite itself, not `npm run dev`: on Windows, killing the npm wrapper leaves Vite listening.
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)
const pageErrors: string[] = []
try {
  await waitForServer(server)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL }) // a fresh context, so IndexedDB starts empty
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto('/')
    await flow({
      page,
      shot: async (name) => {
        const path = join(outDir, `${name}.png`)
        await page.screenshot({ path, fullPage: true })
        process.stdout.write(`${path}\n`)
      },
    })
  } finally {
    await browser.close()
  }
} finally {
  server.kill()
  for (const error of pageErrors) process.stderr.write(`page error: ${error}\n`)
}
if (pageErrors.length) process.exitCode = 1
