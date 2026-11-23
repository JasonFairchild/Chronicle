// Hovering a citation shows what it cites; hovering a cited heading or rule lists what cites it.
// Installed from a .vsix away from the repo, so it loads the resolver from the repo it finds.
import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as vscode from 'vscode'

import type * as Resolver from '../../scripts/prose/citations.ts'

const resolverPath = 'scripts/prose/citations.ts'
/** Past this, a section is cut, so a long one doesn't hide the line being read. */
const maxLines = 40
const maxCiters = 25

/** The nearest folder above a file holding the resolver, so other projects are left alone. */
function repoRoot(file: string): string | undefined {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, resolverPath))) return dir
  return undefined
}

/** A resolver place as an editor position: its line counts from 0. */
const position = ({ line, column }: Resolver.Place) => new vscode.Position(line - 1, column)

/** A Markdown link opening a repo file at a line. */
function lineLink(root: string, path: string, line: number): string {
  const uri = vscode.Uri.file(join(root, path)).with({ fragment: `L${line}` })
  return `[${path}:${line}](${uri.toString()})`
}

/** Where a citation lands, linked, then the section itself. */
function citedHover(root: string, cited: Resolver.Cited) {
  const range = new vscode.Range(position(cited.start), position(cited.end))
  const { section } = cited
  if (!section) return new vscode.Hover('This citation lands nowhere.', range)
  const lines = section.text.split('\n')
  const md = new vscode.MarkdownString(`${lineLink(root, section.doc, section.line)}\n\n---\n\n`)
  // So the section's own relative links open beside the doc they're written in.
  md.baseUri = vscode.Uri.file(join(root, dirname(section.doc), '/'))
  md.appendMarkdown(lines.slice(0, maxLines).join('\n'))
  if (lines.length > maxLines) md.appendMarkdown(`\n\n*…${lines.length - maxLines} more lines*`)
  return new vscode.Hover(md, range)
}

/** Every place citing a heading or rule, each linked. */
function citersHover(root: string, line: number, { leadEnd, citers }: Resolver.Citers) {
  const range = new vscode.Range(line - 1, 0, line - 1, leadEnd)
  const md = new vscode.MarkdownString(
    `**Cited from ${citers.length} place${citers.length === 1 ? '' : 's'}**\n\n`,
  )
  for (const c of citers.slice(0, maxCiters))
    md.appendMarkdown(`- ${lineLink(root, c.file, c.line)} \`${c.raw}\`\n`)
  if (citers.length > maxCiters) md.appendMarkdown(`- *…${citers.length - maxCiters} more*\n`)
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
  if (cited) return citedHover(root, cited)
  const citers = resolver.citersOf(files, path, at)
  return citers && citersHover(root, at.line, citers)
}

export function activate(context: vscode.ExtensionContext): void {
  const hover = vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover })
  context.subscriptions.push(hover)
}
