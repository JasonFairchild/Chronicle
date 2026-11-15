// Lists each comment that uncommitted work adds or changes, file by file, for cr's comment question.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

interface Comment {
  start: number
  end: number
  text: string
  /** A `//` comment with nothing before it on its line, which joins a run of them. */
  ownLine: boolean
}

const scriptKinds: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS,
  '.vue': ts.ScriptKind.TS,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.json': ts.ScriptKind.JSON,
  '.jsonc': ts.ScriptKind.JSON,
}

function git(...args: string[]): string[] {
  return spawnSync('git', args, { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
}

/** Each changed file's new line numbers, or `'all'` for an untracked file. */
function newLines(): Map<string, Set<number> | 'all'> {
  const changed = new Map<string, Set<number> | 'all'>()
  let lines = new Set<number>()
  for (const line of git('diff', 'HEAD', '--unified=0', '--no-color', '--diff-filter=d')) {
    if (line.startsWith('+++ b/')) {
      lines = new Set()
      changed.set(line.slice('+++ b/'.length), lines)
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk) continue
    const start = Number(hunk[1])
    for (let n = start; n < start + Number(hunk[2] ?? 1); n++) lines.add(n)
  }
  for (const path of git('ls-files', '--others', '--exclude-standard')) changed.set(path, 'all')
  return changed
}

/** Every comment TypeScript finds beside a token, in order, with runs of `//` lines joined. */
function comments(text: string, kind: ts.ScriptKind): Comment[] {
  const source = ts.createSourceFile('file', text, ts.ScriptTarget.Latest, true, kind)
  const ranges = new Map<number, ts.CommentRange>()
  const visit = (node: ts.Node) => {
    const leading = ts.getLeadingCommentRanges(text, node.pos) ?? []
    const trailing = ts.getTrailingCommentRanges(text, node.end) ?? []
    for (const range of [...leading, ...trailing]) ranges.set(range.pos, range)
    for (const child of node.getChildren(source)) visit(child)
  }
  visit(source)

  const found: Comment[] = []
  for (const { pos, end, kind } of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
    const line = (at: number) => source.getLineAndCharacterOfPosition(at).line + 1
    const before = text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos)
    const comment = {
      start: line(pos),
      end: line(end),
      text: text.slice(pos, end),
      ownLine: kind === ts.SyntaxKind.SingleLineCommentTrivia && before.trim() === '',
    }
    const previous = found.at(-1)
    if (previous?.ownLine && comment.ownLine && comment.start === previous.end + 1) {
      previous.end = comment.end
      previous.text += `\n${before}${comment.text}`
    } else found.push(comment)
  }
  return found
}

/** The part of a Vue template node this reads. */
interface TemplateNode {
  type: number
  loc: { start: { line: number }; end: { line: number }; source: string }
  children?: TemplateNode[]
}

const templateComment = 3 // Vue's NodeTypes.COMMENT, which compiler-sfc doesn't re-export

/** A `.vue` file's template comments, and its script comments read with the rest blanked. */
function vueComments(text: string): Comment[] {
  const { descriptor } = parse(text)
  let masked = text.replace(/[^\n]/g, ' ')
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue
    const { start, end } = block.loc
    masked = masked.slice(0, start.offset) + block.content + masked.slice(end.offset)
  }
  const found = comments(masked, ts.ScriptKind.TS)
  const visit = ({ type, loc, children = [] }: TemplateNode) => {
    if (type === templateComment) {
      found.push({ start: loc.start.line, end: loc.end.line, text: loc.source, ownLine: false })
    }
    for (const child of children) visit(child)
  }
  if (descriptor.template?.ast) visit(descriptor.template.ast as TemplateNode)
  return found.sort((a, b) => a.start - b.start)
}

let listed = 0
let multiLine = 0
for (const [path, added] of newLines()) {
  const kind = scriptKinds[extname(path)]
  if (kind === undefined) continue
  const raw = readFileSync(path, 'utf8')
  for (const { start, end, text } of path.endsWith('.vue')
    ? vueComments(raw)
    : comments(raw, kind)) {
    const lines = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
    if (added !== 'all' && !lines.some((line) => added.has(line))) continue
    const where = end > start ? `${start}-${end} (${end - start + 1} lines)` : `${start}`
    process.stdout.write(`${path}:${where}\n${text}\n\n`)
    listed++
    if (end > start) multiLine++
  }
}
process.stdout.write(`${listed} comments added or changed, ${multiLine} of more than one line.\n`)
