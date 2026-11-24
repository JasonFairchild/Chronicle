// Hovering a citation shows what it cites; hovering a cited heading or rule lists what cites it.
// Installed from a .vsix away from the repo, so it loads the resolver from the repo it finds.
import { existsSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as vscode from 'vscode'

import type * as Resolver from '../../scripts/prose/citations.ts'

const resolverPath = 'scripts/prose/citations.ts'

/** The line an id sits on in a repo file, if it has it. */
type LineOf = (path: string, id: string) => number | undefined

/** The nearest folder above a file holding the resolver, so other projects are left alone. */
function repoRoot(file: string): string | undefined {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, resolverPath))) return dir
  return undefined
}

/** A resolver place as an editor position: its line counts from 0. */
const position = ({ line, column }: Resolver.Place) => new vscode.Position(line - 1, column)

/** A repo file, opened at a line if given: the only fragment VS Code reads on a file link. */
const fileUri = (root: string, path: string, line?: number) =>
  vscode.Uri.file(join(root, path)).with({ fragment: line ? `L${line}` : '' })

/** A Markdown link opening a repo file at a line. */
function lineLink(root: string, path: string, line: number): string {
  return `[${path}:${line}](${fileUri(root, path, line).toString()})`
}

/** A section's relative links, outside code spans, made absolute, with an `#id` as its line. */
function linksOpened(root: string, doc: string, text: string, lineOf: LineOf): string {
  return text.replace(/`[^`\n]*`|\]\(([^)\s]+)\)/g, (match, href?: string) => {
    if (!href || /^[a-z][\w+.-]*:/i.test(href)) return match
    const [path, id] = href.split('#')
    const file = path ? posix.join(posix.dirname(doc), path) : doc
    return `](${fileUri(root, file, id ? lineOf(file, id) : undefined).toString()})`
  })
}

/** Where a citation lands, linked, then the section itself, and a rule's context below it. */
function citedHover(root: string, cited: Resolver.Cited, lineOf: LineOf) {
  const range = new vscode.Range(position(cited.start), position(cited.end))
  const { section, context } = cited
  if (!section) return new vscode.Hover('This citation lands nowhere.', range)
  const text = context ? `${section.text}\n\n---\n\n${context.text}` : section.text
  const md = new vscode.MarkdownString(`${lineLink(root, section.doc, section.line)}\n\n---\n\n`)
  md.appendMarkdown(linksOpened(root, section.doc, text, lineOf))
  return new vscode.Hover(md, range)
}

/** Every place citing a heading or rule, each linked. */
function citersHover(root: string, line: number, { leadEnd, citers }: Resolver.Citers) {
  const range = new vscode.Range(line - 1, 0, line - 1, leadEnd)
  const md = new vscode.MarkdownString(
    `**Cited from ${citers.length} place${citers.length === 1 ? '' : 's'}**\n\n`,
  )
  for (const c of citers) md.appendMarkdown(`- ${lineLink(root, c.file, c.line)} \`${c.raw}\`\n`)
  return new vscode.Hover(md, range)
}

/** What the citation under the cursor cites, or else who cites the heading or rule there. */
async function provideHover(document: vscode.TextDocument, cursor: vscode.Position) {
  const root = repoRoot(document.uri.fsPath)
  if (!root) return undefined
  // Cached once loaded, so a change to the resolver needs a window reload.
  const resolver: typeof Resolver = await import(pathToFileURL(join(root, resolverPath)).href)
  const path = relative(root, document.uri.fsPath).split(sep).join('/')
  if (!resolver.citable(path)) return undefined
  const files = resolver.readRepo(root)
  files.set(path, document.getText()) // unsaved edits included
  const at = { line: cursor.line + 1, column: cursor.character }
  const cited = resolver.citedAt(files, path, at)
  if (cited) return citedHover(root, cited, (file, id) => resolver.lineOfId(files, file, id))
  const citers = resolver.citersOf(files, path, at)
  return citers && citersHover(root, at.line, citers)
}

export function activate(context: vscode.ExtensionContext): void {
  const hover = vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover })
  context.subscriptions.push(hover)
}
