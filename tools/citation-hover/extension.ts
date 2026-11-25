// Marks citations and what they cite, each hovered for the other; a citation opens on Ctrl+click.
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

/** A document's repo, the resolver there, its path in it, and the repo's files with its own unsaved. */
async function opened(document: vscode.TextDocument) {
  const root = repoRoot(document.uri.fsPath)
  if (!root) return undefined
  // Cached once loaded, so a change to the resolver needs a window reload.
  const resolver: typeof Resolver = await import(pathToFileURL(join(root, resolverPath)).href)
  const path = relative(root, document.uri.fsPath).split(sep).join('/')
  if (!resolver.citable(path)) return undefined
  const files = resolver.readRepo(root)
  files.set(path, document.getText())
  return { root, resolver, path, files }
}

const place = ({ line, character }: vscode.Position) => ({ line: line + 1, column: character })

/** A resolver span as an editor range, whose lines count from 0. */
const range = ({ start, end }: Resolver.Span) =>
  new vscode.Range(start.line - 1, start.column, end.line - 1, end.column)

/** A repo file, opened at a line if given: the only fragment VS Code reads on a file link. */
const fileUri = (root: string, path: string, line?: number) =>
  vscode.Uri.file(join(root, path)).with({ fragment: line ? `L${line}` : '' })

/** A Markdown link opening a repo file at a line. */
function lineLink(root: string, path: string, line: number): string {
  return `[${path}:${line}](${fileUri(root, path, line).toString()})`
}

/** The key held to follow a citation, as VS Code names it in its own "Follow link". */
function followKey(): string {
  const swapped =
    vscode.workspace.getConfiguration('editor').get('multiCursorModifier') === 'ctrlCmd'
  const mac = process.platform === 'darwin'
  if (swapped) return mac ? 'Option' : 'Alt'
  return mac ? 'Cmd' : 'Ctrl'
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
  const { section, context } = cited
  if (!section) return new vscode.Hover('This citation lands nowhere.', range(cited))
  const text = context ? `${section.text}\n\n---\n\n${context.text}` : section.text
  const link = lineLink(root, section.doc, section.line)
  const md = new vscode.MarkdownString(`${link} · ${followKey()}+click to open\n\n---\n\n`)
  md.appendMarkdown(linksOpened(root, section.doc, text, lineOf))
  return new vscode.Hover(md, range(cited))
}

/** Every place citing a heading or rule, each linked. */
function citersHover(root: string, { lead, citers }: Resolver.Citers) {
  const md = new vscode.MarkdownString(
    `**Cited from ${citers.length} place${citers.length === 1 ? '' : 's'}**\n\n`,
  )
  for (const c of citers) md.appendMarkdown(`- ${lineLink(root, c.file, c.line)} \`${c.raw}\`\n`)
  return new vscode.Hover(md, range(lead))
}

/** What the citation under the cursor cites, or else who cites the heading or rule there. */
async function provideHover(document: vscode.TextDocument, cursor: vscode.Position) {
  const repo = await opened(document)
  if (!repo) return undefined
  const { root, resolver, path, files } = repo
  const at = place(cursor)
  const cited = resolver.citedAt(files, path, at)
  if (cited) return citedHover(root, cited, (file, id) => resolver.lineOfId(files, file, id))
  const citers = resolver.citersOf(files, path, at)
  return citers && citersHover(root, citers)
}

/** The line a citation lands on, for Ctrl+click, F12 and peek, with the whole citation as the link. */
async function provideDefinition(
  document: vscode.TextDocument,
  cursor: vscode.Position,
): Promise<vscode.DefinitionLink[] | undefined> {
  const repo = await opened(document)
  if (!repo) return undefined
  const cited = repo.resolver.citedAt(repo.files, repo.path, place(cursor))
  if (!cited?.section) return undefined
  const { doc, line } = cited.section
  const targetRange = new vscode.Range(line - 1, 0, line - 1, 0)
  return [{ originSelectionRange: range(cited), targetUri: fileUri(repo.root, doc), targetRange }]
}

/** Underlined as VS Code underlines a link it detects, so a citation reads as one. */
const citationMark = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline var(--vscode-editor-foreground); text-underline-position: under',
})

/** Dotted, as the web marks what only explains itself on hover, for a lead with nothing to open. */
const citedMark = vscode.window.createTextEditorDecorationType({
  textDecoration:
    'underline dotted var(--vscode-textLink-foreground); text-underline-position: under',
})

/** Marks each citation in an editor, dangling ones too, and each cited lead, as its text stands. */
async function mark(editor: vscode.TextEditor) {
  const repo = await opened(editor.document)
  if (!repo) return
  const { resolver, files, path } = repo
  editor.setDecorations(citationMark, resolver.citationSpans(files, path).map(range))
  editor.setDecorations(
    citedMark,
    resolver.citersIn(files, path).map(({ lead }) => range(lead)),
  )
}

export function activate(context: vscode.ExtensionContext): void {
  const selector = { scheme: 'file' }
  const { window, workspace } = vscode
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, { provideHover }),
    vscode.languages.registerDefinitionProvider(selector, { provideDefinition }),
    citationMark,
    citedMark,
    window.onDidChangeVisibleTextEditors((editors) => editors.forEach(mark)),
    workspace.onDidChangeTextDocument(({ document }) =>
      window.visibleTextEditors.filter((e) => e.document === document).forEach(mark),
    ),
  )
  window.visibleTextEditors.forEach(mark)
}
