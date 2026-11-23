// Finds a source file's comments through TypeScript's and Vue's own parsers, so a `//` in a string
// isn't one. Shared by `npm run comments` and the citation resolver.
import { extname } from 'node:path'

import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

/** A spot in a file: its line counted from 1, as the check reports it, and column from 0, as an editor does. */
export interface Place {
  line: number
  column: number
}

/** Where an offset into a text falls. */
export function placeAt(text: string, offset: number): Place {
  const line = text.slice(0, offset).split('\n').length
  return { line, column: offset - text.lastIndexOf('\n', offset - 1) - 1 }
}

export interface Comment {
  start: number
  /** Its first line's column. */
  column: number
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
      column: before.length,
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

/** CSS's comments between two offsets, by their lines in the whole text. */
function cssComments(text: string, from = 0, to = text.length): Comment[] {
  return [...text.slice(from, to).matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => {
    const { line, column } = placeAt(text, from + m.index)
    const end = placeAt(text, from + m.index + m[0].length).line
    return { start: line, column, end, text: m[0], ownLine: false }
  })
}

/** The part of a Vue template node this reads. */
interface TemplateNode {
  type: number
  loc: { start: { line: number; column: number }; end: { line: number }; source: string }
  children?: TemplateNode[]
}

const templateComment = 3 // Vue's NodeTypes.COMMENT, which compiler-sfc doesn't re-export

/** A `.vue` file's template and style comments, and its script's read with the rest blanked. */
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
      const { line, column } = loc.start
      found.push({
        start: line,
        column: column - 1, // Vue counts from 1
        end: loc.end.line,
        text: loc.source,
        ownLine: false,
      })
    }
    for (const child of children) visit(child)
  }
  if (descriptor.template?.ast) visit(descriptor.template.ast as TemplateNode)
  for (const { loc } of descriptor.styles) {
    found.push(...cssComments(text, loc.start.offset, loc.end.offset))
  }
  return found.sort((a, b) => a.start - b.start)
}

/** A file's comments in order, or undefined for a kind of file this doesn't read. */
export function fileComments(path: string, text: string): Comment[] | undefined {
  if (extname(path) === '.css') return cssComments(text)
  const kind = scriptKinds[extname(path)]
  if (kind === undefined) return undefined
  return path.endsWith('.vue') ? vueComments(text) : comments(text, kind)
}
