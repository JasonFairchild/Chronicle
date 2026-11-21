// Finds and resolves the citations between docs, skills and code comments.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

import { type Comment, fileComments } from './comments.ts'

/** A heading or bold lead a citation can land on, with the lines it spans. */
interface Target {
  /** `4` or `5.2`, from a numbered heading or lead. */
  number?: string
  title: string
  id?: string
  line: number
  /** Last line of the section or bullet, inclusive. */
  endLine: number
}

/** A doc or skill file, under the name citations give it. */
interface Doc {
  path: string
  text: string
  targets: Target[]
}

interface Citation {
  file: string
  line: number
  /** A doc's bare name (`TESTING.md`), or a skill file's repo path. */
  doc: string
  number?: string
  title?: string
  fragment?: string
  /** The `§N` a link shows, which must match where its fragment lands. */
  shownNumber?: string
  /** In a `/** *\/` note, which is read on hover away from the file, so may repeat a citation. */
  inHoverNote: boolean
  raw: string
}

/** Text a file's citations can be in, with a way back from an offset to a file line. */
interface Passage {
  text: string
  lineAt: (offset: number) => number
  hoverNote: boolean
}

export interface Problem {
  kind: 'dangling' | 'stale number' | 'cited twice' | 'duplicate id' | 'prefix only'
  file: string
  line: number
  detail: string
}

export interface Report {
  citations: number
  problems: Problem[]
  /** Citations matching only the start of a heading or lead: listed, not failed. */
  prefixOnly: Problem[]
}

const codeExtensions = new Set(['.ts', '.vue', '.js', '.css', '.jsonc'])
const skillFile = String.raw`\.claude/skills/[\w-]+/[\w.-]+\.md`

/** A doc's bare name, or a skill file's repo path, which is how citations name it. */
function docKey(path: string): string | undefined {
  if (/^(docs\/)?[A-Z_]+\.md$/.test(path)) return basename(path)
  if (new RegExp(`^${skillFile}$`).test(path)) return path
  return undefined
}

/** A doc's headings and bold leads, each with the lines it spans and any id first on its line. */
function targets(text: string): Target[] {
  const lines = text.split(/\r?\n/)
  const found: Target[] = []
  const headings: { level: number; index: number }[] = []
  let fence = false
  lines.forEach((line, i) => {
    if (line.startsWith('```')) fence = !fence
    if (fence) return
    const heading =
      /^(#{1,6})\s+(?:<a id="([^"]+)"><\/a>)?(?:(\d+(?:\.\d+)*)\.?\s+)?(.*?)(?:\s+—\s+.*)?\s*$/.exec(
        line,
      )
    if (heading) {
      headings.push({ level: heading[1].length, index: found.length })
      found.push({
        id: heading[2],
        number: heading[3],
        title: heading[4],
        line: i + 1,
        endLine: lines.length,
      })
      return
    }
    const lead =
      /^\s*(?:[-*]\s+|\d+\.\s+)?(?:<a id="([^"]+)"><\/a>)?\*\*(?:(\d+(?:\.\d+)+)\s+)?(.+?)\*\*/.exec(
        line,
      )
    if (!lead) return
    let end = i + 1
    while (end < lines.length && /^\s{2,}\S/.test(lines[end])) end++
    found.push({ id: lead[1], number: lead[2], title: lead[3], line: i + 1, endLine: end })
  })
  headings.forEach(({ level, index }, n) => {
    const next = headings.slice(n + 1).find((h) => h.level <= level)
    if (next) found[index].endLine = found[next.index].line - 1
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
function commentPassage({ start, text }: Comment): Passage {
  const starts: number[] = []
  let joined = ''
  for (const line of text.split(/\r?\n/)) {
    const continues = joined !== '' && /^\s*(\/\/|\*(?!\*))/.test(line)
    joined += continues ? ' ' : '\n'
    starts.push(joined.length)
    joined += line.replace(/^\s*(\/\/|\*(?!\*)|<!--)\s?/, '')
  }
  return {
    text: joined,
    lineAt: (offset) => start + starts.findLastIndex((at) => at <= offset),
    hoverNote: text.startsWith('/**'),
  }
}

/** Where a file's citations can be: a doc whole, or each of code's comments. */
function passages(file: string, text: string): Passage[] {
  if (codeExtensions.has(extname(file))) return (fileComments(file, text) ?? []).map(commentPassage)
  return [{ text, lineAt: (offset) => text.slice(0, offset).split('\n').length, hoverNote: false }]
}

/** Every citation in one passage of a file. `names` are the docs' bare names, without `.md`. */
function passageCitations(file: string, passage: Passage, names: string[]): Citation[] {
  const alt = names.join('|')
  const isCode = codeExtensions.has(extname(file))
  let body = passage.text
  const found: Citation[] = []
  const add = (
    m: RegExpMatchArray,
    cited: Omit<Citation, 'file' | 'line' | 'raw' | 'inHoverNote'>,
  ) => {
    const line = passage.lineAt(m.index!)
    const raw = m[0].replace(/\s+/g, ' ')
    found.push({ file, line, raw, inHoverNote: passage.hoverNote, ...cited })
  }
  // Each pattern blanks what it reads, so a looser one after it can't read the same text again.
  const read = (pattern: RegExp, each: (m: RegExpMatchArray) => void) => {
    for (const m of [...body.matchAll(pattern)]) {
      each(m)
      body = body.slice(0, m.index) + ' '.repeat(m[0].length) + body.slice(m.index! + m[0].length)
    }
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
  read(new RegExp(String.raw`${doc}#([\w-]+)`, 'g'), (m) =>
    add(m, { doc: m[1] ? `${m[1]}.md` : m[2], fragment: m[3] }),
  )
  const sections = new RegExp(
    String.raw`\b(${alt})(?:\.md)?(?:\]\([^)]*\))?(?:'s|,)?\s+((?:${section})(?:(?:,\s*|\s+and\s+)${section})*)`,
    'g',
  )
  read(sections, (m) => {
    for (const each of m[2].matchAll(new RegExp(section, 'g')))
      add(m, { doc: `${m[1]}.md`, number: each[1] })
  })
  read(new RegExp(String.raw`\b(${alt})(?:\.md)?(?:'s|,)\s+["“]([^"”\n]{2,80})["”]`, 'g'), (m) =>
    add(m, { doc: `${m[1]}.md`, title: m[2] }),
  )
  const own = docKey(file)
  if (own && !isCode) read(new RegExp(section, 'g'), (m) => add(m, { doc: own, number: m[1] }))
  return found
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.:,]+$/, '')
    .replace(/’/g, "'")
    .trim()

/** What a citation lands on; `loose` when only the start of a title matched. */
function resolve(cited: Pick<Citation, 'number' | 'title' | 'fragment'>, all: Target[]) {
  const hit = (target: Target | undefined, loose = false) => target && { target, loose }
  if (cited.fragment) return hit(all.find((t) => t.id === cited.fragment))
  if (cited.number) return hit(all.find((t) => t.number === cited.number))
  const want = normalize(cited.title ?? '')
  return (
    hit(all.find((t) => normalize(t.title) === want)) ??
    hit(
      all.find((t) => normalize(t.title).startsWith(want)),
      true,
    )
  )
}

/** Every citation's problems across a repo, given as relative `/`-separated path → text. */
export function checkCitations(files: Map<string, string>): Report {
  const docs = readDocs(files)
  const names = docNames(docs)
  const report: Report = { citations: 0, problems: [], prefixOnly: [] }

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
    const isCode = codeExtensions.has(extname(path))
    // A plan quotes old wording on purpose.
    if ((!isCode && extname(path) !== '.md') || /^Status:/m.test(text)) continue
    const landed = new Map<string, number>()
    for (const c of passages(path, text).flatMap((p) => passageCitations(path, p, names))) {
      report.citations++
      const problem = (kind: Problem['kind'], detail: string) => ({
        kind,
        file: path,
        line: c.line,
        detail,
      })
      const r = resolve(c, docs.get(c.doc)?.targets ?? [])
      if (!r) {
        report.problems.push(problem('dangling', c.raw))
        continue
      }
      if (c.shownNumber && c.shownNumber !== r.target.number)
        report.problems.push(
          problem(
            'stale number',
            `${c.raw} shows §${c.shownNumber}, lands on §${r.target.number ?? '(none)'}`,
          ),
        )
      if (r.loose) report.prefixOnly.push(problem('prefix only', `${c.raw} ~ "${r.target.title}"`))
      if (!isCode || c.inHoverNote) continue
      const key = `${c.doc}:${r.target.line}`
      const first = landed.get(key)
      if (first) report.problems.push(problem('cited twice', `${c.raw}, also on line ${first}`))
      else landed.set(key, c.line)
    }
  }
  return report
}

/** The lines a citation lands on, read as the check reads one in a doc. */
export function citedText(
  files: Map<string, string>,
  citation: string,
): { doc: string; line: number; text: string } | undefined {
  const docs = readDocs(files)
  const passage = { text: citation, lineAt: () => 1, hoverNote: false }
  const [cited] = passageCitations('', passage, docNames(docs))
  const doc = cited && docs.get(cited.doc)
  const r = doc && resolve(cited, doc.targets)
  if (!r) return undefined
  const lines = doc.text.split(/\r?\n/).slice(r.target.line - 1, r.target.endLine)
  return { doc: doc.path, line: r.target.line, text: lines.join('\n').trimEnd() }
}

/** Every file a citation can be in or land on, under the working directory, as path → text. */
export function readRepo(): Map<string, string> {
  const wanted = (path: string) => extname(path) === '.md' || codeExtensions.has(extname(path))
  let paths: string[]
  if (existsSync('.git')) {
    // Through git, so a locally excluded private file isn't read.
    const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
    })
    paths = listed.stdout.split('\n').filter((p) => p && existsSync(p))
  } else {
    // Pre-commit's `.staged/` copy has no `.git`, and holds only what's staged.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = dir === '.' ? name : `${dir}/${name}`
        if (name === 'node_modules') return []
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    paths = walk('.')
  }
  return new Map(paths.filter(wanted).map((p) => [p, readFileSync(p, 'utf8')]))
}
