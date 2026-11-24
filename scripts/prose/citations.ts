// Finds and resolves the citations between docs, skills and code comments.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

import { type Comment, fileComments, type Place, placeAt } from './comments.ts'

export type { Place }

/** A heading, or a line with an id or a numbered rule, with the lines it spans. */
interface Target {
  /** `4` or `5.2`, from a numbered heading or rule. */
  number?: string
  id?: string
  line: number
  /** Last line of the section or bullet, inclusive. */
  endLine: number
  /** Where its lead ends on its line: a heading's whole line, or a rule's id and bold. */
  leadEnd: number
  /** A heading's level, the title's being 1; a rule has none. */
  level?: number
}

/** A doc or skill file, under the name citations give it. */
interface Doc {
  path: string
  text: string
  targets: Target[]
}

interface Citation extends Place {
  file: string
  /** Just past its last character. */
  end: Place
  /** A doc's bare name (`TESTING.md`), or a skill file's repo path. */
  doc: string
  number?: string
  fragment?: string
  /**
   * `id` is a link or a plain `DOC.md#id`; `prose`, another doc named with a `§N` or a quoted title,
   * which the check fails; `short`, a `§N` alone, naming no doc.
   */
  form: 'id' | 'prose' | 'short'
  /** The `§N` a link or a plain `DOC.md#id (§N)` shows, which must match where its fragment lands. */
  shownNumber?: string
  /** In a `/** *\/` note, which is read on hover away from the file, so may repeat a citation. */
  inHoverNote: boolean
  raw: string
  /** What it lands on, once resolved. */
  target?: Target
  /** A short citation in a doc without numbers, beside no other doc or several, so naming none. */
  shortUnresolved?: boolean
  /** For a short citation in a doc with numbers, the other docs beside it with its number too. */
  alsoIn?: string[]
}

/** Text a file's citations can be in, with a way back from an offset to its place in the file. */
interface Passage {
  text: string
  placeAt: (offset: number) => Place
  hoverNote: boolean
}

export interface Problem {
  kind:
    | 'dangling'
    | 'stale number'
    | 'missing number'
    | 'cited twice'
    | 'duplicate id'
    | 'prose citation'
    | 'no id'
    | 'ambiguous'
  file: string
  line: number
  detail: string
}

export interface Report {
  citations: number
  problems: Problem[]
}

const codeExtensions = new Set(['.ts', '.vue', '.js', '.css', '.jsonc'])
/** Whether a file can hold a citation or be cited. */
export const citable = (path: string) =>
  extname(path) === '.md' || codeExtensions.has(extname(path))
const skillFile = String.raw`\.claude/skills/[\w-]+/[\w.-]+\.md`

/** A doc's bare name, or a skill file's repo path, which is how citations name it. */
function docKey(path: string): string | undefined {
  if (/^(docs\/)?[A-Z_]+\.md$/.test(path)) return basename(path)
  if (new RegExp(`^${skillFile}$`).test(path)) return path
  return undefined
}

/** A doc's headings, ids and numbered rules, each with the lines it spans. */
function targets(text: string): Target[] {
  const lines = text.split(/\r?\n/)
  const found: Target[] = []
  let fence = false
  lines.forEach((line, i) => {
    if (line.startsWith('```')) fence = !fence
    if (fence) return
    const heading = /^(#{1,6})\s+(?:<a id="([^"]+)"><\/a>)?(?:(\d+(?:\.\d+)*)\.?\s)?/.exec(line)
    if (heading) {
      const [, marks, id, number] = heading
      const level = marks.length
      found.push({ id, number, line: i + 1, endLine: lines.length, leadEnd: line.length, level })
      return
    }
    const rule =
      /^\s*(?:[-*]\s+|\d+\.\s+)?(?:<a id="([^"]+)"><\/a>)?(?:\*\*(\d+(?:\.\d+)+) -\*\*)?/.exec(
        line,
      )!
    if (!rule[1] && !rule[2]) return
    // Only lines indented past its own marker continue it, so a sibling sub-bullet doesn't.
    const deeper = new RegExp(String.raw`^\s{${/^\s*/.exec(line)![0].length + 2},}\S`)
    let end = i + 1
    while (end < lines.length && deeper.test(lines[end])) end++
    // An unnumbered rule's bold names it, as a number would.
    const bold = rule[2] ? '' : (/^\*\*[^*\n]+\*\*/.exec(line.slice(rule[0].length))?.[0] ?? '')
    const leadEnd = rule[0].length + bold.length
    found.push({ id: rule[1], number: rule[2], line: i + 1, endLine: end, leadEnd })
  })
  const headings = found.filter((t) => t.level)
  headings.forEach((h, n) => {
    const next = headings.slice(n + 1).find((o) => o.level! <= h.level!)
    if (next) h.endLine = next.line - 1
  })
  return found
}

/** Every doc and skill file in a repo, by how citations name it. */
function readDocs(files: Map<string, string>): Map<string, Doc> {
  const docs = new Map<string, Doc>()
  for (const [path, text] of files) {
    const key = docKey(path)
    if (key) docs.set(key, { path, text, targets: targets(text) })
  }
  return docs
}

/** The docs' bare names, without `.md`; a skill file is cited by its path. */
const docNames = (docs: Map<string, Doc>) =>
  [...docs.keys()].filter((key) => !key.includes('/')).map((key) => key.replace(/\.md$/, ''))

/** A comment as a passage, with continuation lines joined so a citation across them reads whole. */
function commentPassage({ start, column, text }: Comment): Passage {
  // Each line's offset in the joined text, and the file column its kept text starts at.
  const starts: { at: number; column: number }[] = []
  let joined = ''
  for (const line of text.split(/\r?\n/)) {
    const continues = joined !== '' && /^\s*(\/\/|\*(?!\*))/.test(line)
    joined += continues ? ' ' : '\n'
    const kept = line.replace(/^\s*(\/\/|\*(?!\*)|<!--)\s?/, '')
    // Only the first line starts partway along; the rest hold their file line from column 0.
    const lineStart = starts.length ? 0 : column
    starts.push({ at: joined.length, column: lineStart + line.length - kept.length })
    joined += kept
  }
  return {
    text: joined,
    placeAt: (offset) => {
      const i = starts.findLastIndex(({ at }) => at <= offset)
      return { line: start + i, column: starts[i].column + offset - starts[i].at }
    },
    hoverNote: text.startsWith('/**'),
  }
}

/** Where a file's citations can be: a doc whole, or each of code's comments. */
function passages(file: string, text: string): Passage[] {
  if (codeExtensions.has(extname(file))) return (fileComments(file, text) ?? []).map(commentPassage)
  return [{ text, placeAt: (offset) => placeAt(text, offset), hoverNote: false }]
}

/** Every citation in one passage of a file. `names` are the docs' bare names, without `.md`. */
function passageCitations(file: string, passage: Passage, names: string[]): Citation[] {
  const alt = names.join('|')
  const isCode = codeExtensions.has(extname(file))
  // A code span is an example of a citation, not one.
  let body = passage.text.replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length))
  const found: Citation[] = []
  // Each pattern blanks what it reads, so a looser one after it can't read the same text again.
  const read = (pattern: RegExp, each: (m: RegExpMatchArray) => void) => {
    for (const m of [...body.matchAll(pattern)]) {
      each(m)
      body = body.slice(0, m.index) + ' '.repeat(m[0].length) + body.slice(m.index! + m[0].length)
    }
  }
  const add = (
    m: RegExpMatchArray,
    cited: Pick<Citation, 'doc' | 'number' | 'fragment' | 'shownNumber'>,
    form: Citation['form'] = 'id',
  ) => {
    const place = passage.placeAt(m.index!)
    const end = passage.placeAt(m.index! + m[0].length)
    const raw = m[0].replace(/\s+/g, ' ')
    found.push({ file, ...place, end, raw, inHoverNote: passage.hoverNote, form, ...cited })
  }
  const doc = String.raw`(?:\b(${alt})\.md|(${skillFile}))`
  const section = String.raw`§\s?(\d+(?:\.\d+)*)`
  read(new RegExp(String.raw`\[([^\]]*)\]\([^)\s]*?${doc}#([^)\s]+)\)`, 'g'), (m) =>
    add(m, {
      doc: m[2] ? `${m[2]}.md` : m[3],
      fragment: m[4],
      shownNumber: new RegExp(section).exec(m[1])?.[1],
    }),
  )
  read(new RegExp(String.raw`${doc}#([\w-]+)(?:\s+\(${section}\))?`, 'g'), (m) =>
    add(m, { doc: m[1] ? `${m[1]}.md` : m[2], fragment: m[3], shownNumber: m[4] }),
  )
  const sections = new RegExp(
    String.raw`\b(${alt})(?:\.md)?(?:\]\([^)]*\))?(?:'s|,)?\s+((?:${section})(?:(?:,\s*|\s+and\s+)${section})*)`,
    'g',
  )
  read(sections, (m) => {
    for (const each of m[2].matchAll(new RegExp(section, 'g')))
      add(m, { doc: `${m[1]}.md`, number: each[1] }, 'prose')
  })
  read(new RegExp(String.raw`\b(${alt})(?:\.md)?(?:'s|,)\s+["“][^"”\n]{2,80}["”]`, 'g'), (m) =>
    add(m, { doc: `${m[1]}.md` }, 'prose'),
  )
  const own = docKey(file)
  if (own && !isCode)
    read(new RegExp(section, 'g'), (m) => add(m, { doc: own, number: m[1] }, 'short'))
  return found
}

/** What a citation lands on, by its id or else its number. */
function resolve(cited: Pick<Citation, 'number' | 'fragment'>, all: Target[]) {
  if (cited.fragment) return all.find((t) => t.id === cited.fragment)
  if (cited.number) return all.find((t) => t.number === cited.number)
  return undefined
}

/** Every citation in one file with what it lands on, each short one read against the doc it names. */
function resolvedCitations(path: string, text: string, docs: Map<string, Doc>): Citation[] {
  const own = docKey(path)
  const numbered = !!own && !!docs.get(own)?.targets.some((t) => t.number)
  const names = docNames(docs)
  const cited = passages(path, text).flatMap((p) => passageCitations(path, p, names))
  const targetsOf = (doc: string) => docs.get(doc)?.targets ?? []
  for (const c of cited) {
    if (c.form === 'short') {
      const beside = new Set(
        cited.filter((o) => o.line === c.line && o.doc !== own).map((o) => o.doc),
      )
      // In a doc with numbers it is its own; another doc beside it with that number may be meant.
      if (numbered) c.alsoIn = [...beside].filter((doc) => resolve(c, targetsOf(doc)))
      // In a doc with no numbers of its own, it is the one other doc beside it.
      else {
        c.shortUnresolved = beside.size !== 1
        if (c.shortUnresolved) continue
        c.doc = [...beside][0]
      }
    }
    c.target = resolve(c, targetsOf(c.doc))
  }
  return cited
}

/**
 * Every citation's problems across a repo, given as relative `/`-separated path → text, with its
 * docs as committed at git HEAD in `gitHead`, which tells a short citation a renumber left behind.
 */
export function checkCitations(
  files: Map<string, string>,
  gitHead = new Map<string, string>(),
): Report {
  const docs = readDocs(files)
  const gitHeadDocs = readDocs(gitHead)
  const report: Report = { citations: 0, problems: [] }

  for (const { path, targets } of docs.values()) {
    const seen = new Map<string, number>()
    for (const t of targets.filter((t) => t.id)) {
      const first = seen.get(t.id!)
      if (first)
        report.problems.push({
          kind: 'duplicate id',
          file: path,
          line: t.line,
          detail: `${t.id}, also on line ${first}`,
        })
      else seen.set(t.id!, t.line)
    }
  }

  for (const [path, text] of files) {
    if (!citable(path)) continue
    const isCode = codeExtensions.has(extname(path))
    const lines = text.split(/\r?\n/)
    const gitHeadLines = new Set(gitHead.get(path)?.split(/\r?\n/))
    const landed = new Map<string, number>()
    for (const c of resolvedCitations(path, text, docs)) {
      report.citations++
      const problem = (kind: Problem['kind'], detail: string) => ({
        kind,
        file: path,
        line: c.line,
        detail,
      })
      const { target } = c
      if (c.shortUnresolved) {
        report.problems.push(
          problem('dangling', `${c.raw}, with no one other doc cited in its paragraph`),
        )
        continue
      }
      if (c.form === 'prose') {
        const form = target?.id ? `: cite as ${c.doc}#${target.id}` : ''
        report.problems.push(problem('prose citation', c.raw + form))
        continue
      }
      // A changed line is trusted, since a renumber rewrites the numbers it cites in the same diff.
      const was =
        c.form === 'short' && gitHeadLines.has(lines[c.line - 1])
          ? resolve(c, gitHeadDocs.get(c.doc)?.targets ?? [])?.id
          : undefined
      if (was) {
        const now = docs.get(c.doc)?.targets.find((t) => t.id === was)
        if (now?.number !== c.number) {
          const at = !now ? 'gone' : now.number ? `§${now.number}` : 'unnumbered'
          report.problems.push(problem('stale number', `${c.raw} was ${was} at HEAD, now ${at}`))
          continue
        }
      }
      if (!target) {
        report.problems.push(problem('dangling', c.raw))
        continue
      }
      if (c.alsoIn?.length) {
        const docs = c.alsoIn.join(' and ')
        const detail = `${c.raw} is also in ${docs}, cited beside it: cite the one meant by id`
        report.problems.push(problem('ambiguous', detail))
        continue
      }
      if (c.form === 'short' && !target.id)
        report.problems.push(problem('no id', `${c.raw} lands on a target with no id`))
      if (c.shownNumber && c.shownNumber !== target.number)
        report.problems.push(
          problem(
            'stale number',
            `${c.raw} shows §${c.shownNumber}, lands on §${target.number ?? '(none)'}`,
          ),
        )
      if (c.fragment && !c.shownNumber && target.number)
        report.problems.push(problem('missing number', `${c.raw} lands on §${target.number}`))
      if (!isCode || c.inHoverNote) continue
      const key = `${c.doc}:${target.line}`
      const first = landed.get(key)
      if (first) report.problems.push(problem('cited twice', `${c.raw}, also on line ${first}`))
      else landed.set(key, c.line)
    }
  }
  return report
}

/** What a citation lands on. */
export interface Section {
  doc: string
  line: number
  text: string
}

/** A target's lines, through the end of its section or bullet. */
function section(doc: Doc, target: Target): Section {
  const lines = doc.text.split(/\r?\n/).slice(target.line - 1, target.endLine)
  return { doc: doc.path, line: target.line, text: lines.join('\n').trimEnd() }
}

/** The lines a citation lands on, read as the check reads one in a doc. */
export function citedText(files: Map<string, string>, citation: string): Section | undefined {
  const docs = readDocs(files)
  const [cited] = resolvedCitations('', citation, docs)
  if (!cited?.target) return undefined
  return section(docs.get(cited.doc)!, cited.target)
}

const before = (a: Place, b: Place) => a.line < b.line || (a.line === b.line && a.column < b.column)

/** A citation's span, and the section it lands on unless it dangles. */
export interface Cited {
  start: Place
  end: Place
  section?: Section
  /** For a cited rule, the heading or rule it sits in, so it's read in its place. */
  context?: Section
}

/** The nearest target above one whose lines hold all of its own. */
function container({ targets }: Doc, target: Target): Target | undefined {
  return targets.slice(0, targets.indexOf(target)).findLast((t) => t.endLine >= target.endLine)
}

/** The citation over a place in one of `files`. */
export function citedAt(files: Map<string, string>, path: string, at: Place): Cited | undefined {
  const docs = readDocs(files)
  const cited = resolvedCitations(path, files.get(path) ?? '', docs).find(
    (c) => !before(at, c) && before(at, c.end),
  )
  if (!cited) return undefined
  const { line, column, end, target } = cited
  if (!target) return { start: { line, column }, end }
  const doc = docs.get(cited.doc)!
  // A heading's section already holds its rules, and the title's is the whole doc.
  const around = target.level ? undefined : container(doc, target)
  const context = around?.level === 1 ? undefined : around
  return {
    start: { line, column },
    end,
    section: section(doc, target),
    context: context && section(doc, context),
  }
}

/** Where a cited heading's or rule's lead ends on its line, and each place that cites it. */
export interface Citers {
  leadEnd: number
  citers: { file: string; line: number; raw: string }[]
}

/** Every citation landing on the heading or rule whose lead holds a place in a doc, if any does. */
export function citersOf(files: Map<string, string>, path: string, at: Place): Citers | undefined {
  const docs = readDocs(files)
  const key = docKey(path)
  const target = key
    ? docs.get(key)?.targets.find((t) => t.line === at.line && at.column < t.leadEnd)
    : undefined
  if (!target) return undefined
  const citers = [...files]
    .filter(([file]) => citable(file))
    .flatMap(([file, text]) => resolvedCitations(file, text, docs))
    .filter((c) => c.target === target)
    .map(({ file, line, raw }) => ({ file, line, raw }))
  return citers.length ? { leadEnd: target.leadEnd, citers } : undefined
}

/** The line an id sits on in one of `files`, by its repo path, as a relative link finds it. */
export function lineOfId(files: Map<string, string>, path: string, id: string): number | undefined {
  const text = files.get(path)
  return text === undefined ? undefined : targets(text).find((t) => t.id === id)?.line
}

/** The docs and skill files among `paths` as committed at HEAD, as path → text. */
export function readGitHead(paths: Iterable<string>): Map<string, string> {
  const gitHead = new Map<string, string>()
  for (const path of [...paths].filter((p) => docKey(p))) {
    // Git finds the repo from pre-commit's `.staged/` copy too, since that sits inside it.
    const shown = spawnSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' })
    if (shown.status === 0) gitHead.set(path, shown.stdout)
  }
  return gitHead
}

/** Every file a citation can be in or land on, under `root`, as path from `root` → text. */
export function readRepo(root = '.'): Map<string, string> {
  const at = (path: string) => join(root, path)
  let paths: string[]
  if (existsSync(at('.git'))) {
    // Through git, so a locally excluded private file isn't read.
    const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    })
    paths = listed.stdout.split('\n').filter((p) => p && existsSync(at(p)))
  } else {
    // Pre-commit's `.staged/` copy has no `.git`, and holds only what's staged.
    const walk = (dir: string): string[] =>
      readdirSync(at(dir)).flatMap((name) => {
        const path = dir === '.' ? name : `${dir}/${name}`
        if (name === 'node_modules') return []
        return statSync(at(path)).isDirectory() ? walk(path) : [path]
      })
    paths = walk('.')
  }
  return new Map(paths.filter(citable).map((p) => [p, readFileSync(at(p), 'utf8')]))
}
