// Finds and resolves the citations between docs, skills and code comments.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

import { type Comment, fileComments } from './comments.ts'

/** A heading, or a line with an id or a numbered rule, with the lines it spans. */
interface Target {
  /** `4` or `5.2`, from a numbered heading or rule. */
  number?: string
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
  fragment?: string
  /**
   * `id` is a link or a plain `DOC.md#id`; `prose`, a doc cited by `§N` or a quoted name, which the
   * id form replaces; `bare`, a `§N` alone, in its own doc or as shorthand.
   */
  form: 'id' | 'prose' | 'bare'
  /** The `§N` a link or a plain `DOC.md#id (§N)` shows, which must match where its fragment lands. */
  shownNumber?: string
  /** In a `/** *\/` note, which is read on hover away from the file, so may repeat a citation. */
  inHoverNote: boolean
  raw: string
  /** What it lands on, once resolved. */
  target?: Target
  /** A shorthand `§N` beside no other doc, or several, so with no doc to read it against. */
  shorthandUnresolved?: boolean
}

/** Text a file's citations can be in, with a way back from an offset to a file line. */
interface Passage {
  text: string
  lineAt: (offset: number) => number
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
  file: string
  line: number
  detail: string
}

export interface Report {
  citations: number
  problems: Problem[]
}

const codeExtensions = new Set(['.ts', '.vue', '.js', '.css', '.jsonc'])
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
  const headings: { level: number; index: number }[] = []
  let fence = false
  lines.forEach((line, i) => {
    if (line.startsWith('```')) fence = !fence
    if (fence) return
    const heading = /^(#{1,6})\s+(?:<a id="([^"]+)"><\/a>)?(?:(\d+(?:\.\d+)*)\.?\s)?/.exec(line)
    if (heading) {
      headings.push({ level: heading[1].length, index: found.length })
      found.push({ id: heading[2], number: heading[3], line: i + 1, endLine: lines.length })
      return
    }
    const rule =
      /^\s*(?:[-*]\s+|\d+\.\s+)?(?:<a id="([^"]+)"><\/a>)?(?:\*\*(\d+(?:\.\d+)+) -\*\*)?/.exec(
        line,
      )!
    if (!rule[1] && !rule[2]) return
    let end = i + 1
    while (end < lines.length && /^\s{2,}\S/.test(lines[end])) end++
    found.push({ id: rule[1], number: rule[2], line: i + 1, endLine: end })
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
    const line = passage.lineAt(m.index!)
    const raw = m[0].replace(/\s+/g, ' ')
    found.push({ file, line, raw, inHoverNote: passage.hoverNote, form, ...cited })
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
    read(new RegExp(section, 'g'), (m) => add(m, { doc: own, number: m[1] }, 'bare'))
  return found
}

/** What a citation lands on, by its id or else its number. */
function resolve(cited: Pick<Citation, 'number' | 'fragment'>, all: Target[]) {
  if (cited.fragment) return all.find((t) => t.id === cited.fragment)
  if (cited.number) return all.find((t) => t.number === cited.number)
  return undefined
}

/** Every citation in one file with what it lands on, each shorthand read as the doc it stands for. */
function resolvedCitations(path: string, text: string, docs: Map<string, Doc>): Citation[] {
  const own = docKey(path)
  const numbered = !!own && !!docs.get(own)?.targets.some((t) => t.number)
  const names = docNames(docs)
  const cited = passages(path, text).flatMap((p) => passageCitations(path, p, names))
  for (const c of cited) {
    // Shorthand: in a doc with no numbers of its own, a bare `§N` is the one other doc beside it.
    if (c.form === 'bare' && !numbered) {
      const beside = new Set(
        cited.filter((o) => o.line === c.line && o.doc !== own).map((o) => o.doc),
      )
      c.shorthandUnresolved = beside.size !== 1
      if (c.shorthandUnresolved) continue
      c.doc = [...beside][0]
    }
    c.target = resolve(c, docs.get(c.doc)?.targets ?? [])
  }
  return cited
}

/**
 * Every citation's problems across a repo, given as relative `/`-separated path → text, with its
 * docs as committed at git HEAD in `gitHead`, which tells a bare `§N` a renumber left behind.
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
    const isCode = codeExtensions.has(extname(path))
    if (!isCode && extname(path) !== '.md') continue
    // A plan quotes old wording on purpose, so only its ids and links are checked.
    const plan = /^Status:/m.test(text)
    const lines = text.split(/\r?\n/)
    const gitHeadLines = new Set(gitHead.get(path)?.split(/\r?\n/))
    const landed = new Map<string, number>()
    for (const c of resolvedCitations(path, text, docs)) {
      if (plan && c.form !== 'id') continue
      report.citations++
      const problem = (kind: Problem['kind'], detail: string) => ({
        kind,
        file: path,
        line: c.line,
        detail,
      })
      const { target } = c
      if (c.shorthandUnresolved) {
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
        c.form === 'bare' && gitHeadLines.has(lines[c.line - 1])
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
      if (c.form === 'bare' && !target.id)
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

/** The lines a citation lands on, read as the check reads one in a doc. */
export function citedText(
  files: Map<string, string>,
  citation: string,
): { doc: string; line: number; text: string } | undefined {
  const docs = readDocs(files)
  const [cited] = resolvedCitations('', citation, docs)
  const target = cited?.target
  if (!target) return undefined
  const doc = docs.get(cited.doc)!
  const lines = doc.text.split(/\r?\n/).slice(target.line - 1, target.endLine)
  return { doc: doc.path, line: target.line, text: lines.join('\n').trimEnd() }
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
