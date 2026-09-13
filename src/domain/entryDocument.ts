/**
 * The document layer: one canonical way to turn an entry's stored `content` into plain text.
 *
 * `Entry.content` is a serialized ProseMirror document. Search, timeline previews, and diffs all
 * need the same flat string, and they must agree to the character. So there is exactly one function
 * that does it, `docToPlainText`, and everything calls it. Anchors no longer measure against this
 * ruler — they are marks and nodes in the document itself — but they do depend on it ignoring what
 * they add, which is what `ANCHOR_INSERT_NODE` below is about.
 *
 * Nothing here imports TipTap. The flattening is a walk over plain JSON, which keeps it pure,
 * runnable in node, and independent of whichever editor sits on top.
 */

/** A ProseMirror node as it serializes to JSON. Structural only; the editor owns the schema. */
export interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface EntryDocument extends DocNode {
  type: 'doc'
  content: DocNode[]
}

/**
 * The first node of a titled entry's document. Untitled entries omit it.
 *
 * Nothing in the editor's schema knows this node: a title is typed in its own plain field, and this
 * module is what joins that field's text to the body on its way to storage (`titledDocument`) and
 * splits it back off on the way out (`docBody`). Storing them as one document is what makes renaming
 * an entry an ordinary revision rather than a second kind of write.
 */
export const TITLE_NODE = 'title'

/** An image whose bytes live in the media store; the node carries only the blob's id. */
export const MEDIA_NODE = 'mediaImage'

/**
 * A span anchor: a mark on the parent's own text carrying `{ anchorId, kind }`. Marks are metadata
 * riding on text that is already there, so the flattening below never has to know about this one.
 */
export const ANCHOR_MARK = 'anchor'

/**
 * A collapsed anchor: wording a child entry proposes, carrying `{ anchorId, text }`. A mark cannot
 * represent a zero-width position with content of its own, so this is a node — and being a node,
 * it holds real text that the flattening **must** skip. That skip is the mechanism that makes "no
 * child entry is destructive" checkable rather than merely intended: with it, an anchor-mode
 * session leaves `docToPlainText` untouched, so `sameContent(before, after)` holds by construction
 * and previews and search never fill up with words the parent's author didn't write.
 */
export const ANCHOR_INSERT_NODE = 'anchorInsert'

/** Nodes that sit inside a line rather than starting one. */
const INLINE_NODES = new Set(['text', 'hardBreak', ANCHOR_INSERT_NODE])

/**
 * Reads stored content as a document. `Entry.content` is always a real serialized document — see
 * CLAUDE.md, "No backward compatibility" — so invalid content is a real bug and throws rather than
 * being silently reinterpreted.
 *
 * The empty string is the one exception, not a format to sniff: every session ref that will hold a
 * document starts life as `ref('')`, before an editor has mounted or a draft has been typed into,
 * and that transient not-yet-anything state never reaches storage (`requireContent` refuses to save
 * an empty document). It reads as a blank document rather than throwing.
 */
export function parseDocument(content: string | EntryDocument): EntryDocument {
  if (typeof content !== 'string') return content
  if (content === '') return emptyDocument()

  const parsed: unknown = JSON.parse(content)
  if (!isEntryDocument(parsed)) {
    throw new Error('Stored content is not a serialized document')
  }
  return parsed
}

export function serializeDocument(doc: EntryDocument): string {
  return JSON.stringify(doc)
}

/** Wraps plain text as a document, one paragraph per line. */
export function plainTextDocument(text: string, title?: string | null): EntryDocument {
  const paragraphs = text.split('\n').map((line): DocNode => {
    return line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  })

  const heading: DocNode[] = title
    ? [{ type: TITLE_NODE, content: [{ type: 'text', text: title }] }]
    : []

  return { type: 'doc', content: [...heading, ...paragraphs] }
}

/**
 * Plain text as stored content — the real document `Entry.content` always holds, built from a body
 * and an optional title. The one deliberate, named way to turn plain text into a document, used by
 * the store's simple non-session creation methods and by tests that don't care about rich formatting.
 */
export function textContent(body: string, title?: string | null): string {
  return serializeDocument(plainTextDocument(body, title))
}

/**
 * The canonical flattening: the document's body as plain text, one line per block.
 *
 * The title node is deliberately excluded: a title is a name for the record, not part of what it
 * says, and a preview or a search hit made of the title alone would be noise. `docTitle` is how the
 * title is read instead. Anchor-carried wording is excluded for its own reason — see `nodeText`.
 */
export function docToPlainText(content: string | EntryDocument): string {
  const doc = parseDocument(content)

  return doc.content
    .filter((node) => node.type !== TITLE_NODE)
    .map(nodeText)
    .join('\n')
}

/**
 * A document's body as one line, trimmed to `limit`, for a card, a list row, or a picker label.
 *
 * Built on `docToPlainText` like everything else, so a preview and a search hit measure the same
 * text — which also means anchor-carried wording never leaks into a summary of the parent. `limit`
 * is all call sites disagree on: a timeline card has a paragraph's worth of room, a picker option
 * has part of a line. An empty document previews as the empty string rather than inventing a name
 * for itself, leaving the caller to supply wording that fits where it is being shown.
 */
export function previewText(content: string | EntryDocument, limit = 160): string {
  const singleLine = docToPlainText(content).replace(/\s+/g, ' ').trim()
  return singleLine.length > limit ? `${singleLine.slice(0, limit - 3)}...` : singleLine
}

/** Whether the document has a title node at all, regardless of whether it holds any text. */
export function hasTitleNode(content: string | EntryDocument): boolean {
  return parseDocument(content).content.some((node) => node.type === TITLE_NODE)
}

/** The document's title, or null when it has none or it is blank. */
export function docTitle(content: string | EntryDocument): string | null {
  const doc = parseDocument(content)
  const title = doc.content.find((node) => node.type === TITLE_NODE)
  if (!title) return null

  const text = nodeText(title).trim()
  return text || null
}

/**
 * Everything but the title: the document the body editor actually opens.
 *
 * An empty result becomes a blank paragraph rather than nothing, because the body's schema is
 * `block+` — a document with no blocks at all is one the editor cannot hold.
 */
export function docBody(content: string | EntryDocument): EntryDocument {
  const body = parseDocument(content).content.filter((node) => node.type !== TITLE_NODE)
  return { type: 'doc', content: body.length > 0 ? body : [{ type: 'paragraph' }] }
}

/**
 * The inverse: a body and a title text, rejoined into the one document that gets stored.
 *
 * A blank title still leaves the node behind. Nothing is owed — a title is optional everywhere — but
 * the node is what `hasTitleNode` reads to decide whether to offer the field again, so dropping it
 * would mean a draft resumed after being left unnamed came back with nowhere to put a name.
 */
export function titledDocument(body: EntryDocument, title: string): EntryDocument {
  const node: DocNode = title
    ? { type: TITLE_NODE, content: [{ type: 'text', text: title }] }
    : { type: TITLE_NODE }

  return { type: 'doc', content: [node, ...docBody(body).content] }
}

/**
 * Every media id the document depends on, in document order and without repeats. This is what
 * fills `Entry.media_refs`, so the column is derived from the document rather than maintained
 * alongside it and able to drift from it.
 */
export function collectMediaRefs(content: string | EntryDocument): string[] {
  const refs = new Set<string>()

  walk(parseDocument(content), (node) => {
    if (node.type !== MEDIA_NODE) return
    const ref = node.attrs?.mediaRef
    if (typeof ref === 'string' && ref) refs.add(ref)
  })

  return [...refs]
}

/** True when there is nothing worth saving: no body text, no title, and no media. */
export function isEmptyDocument(content: string | EntryDocument): boolean {
  const doc = parseDocument(content)

  return (
    docToPlainText(doc).trim() === '' &&
    docTitle(doc) === null &&
    collectMediaRefs(doc).length === 0
  )
}

/**
 * True when two documents say the same thing: the same title, the same body text, and the same
 * attachments. Only their presentation differs.
 *
 * This is how a formatting change is told apart from an edit, and it is deliberately a comparison
 * of outcomes rather than a list of editor operations. Marks arrive as `addMark`/`removeMark`, but
 * alignment and spacing arrive as attribute steps, and wrapping a paragraph in a list arrives as a
 * `replaceAround` that no step type distinguishes from a real edit. Measuring against the same
 * three things `isEmptyDocument` calls content cannot be broken by whichever extension is added
 * next.
 */
export function sameContent(a: string | EntryDocument, b: string | EntryDocument): boolean {
  const before = parseDocument(a)
  const after = parseDocument(b)

  return (
    // Trimmed, as `isEmptyDocument` trims: the editor keeps an empty paragraph at the end of a
    // document so there is always somewhere to click, and appends one when the last block becomes
    // a heading. That scaffolding is the editor's, not the author's, and counting it would report
    // every heading as an edit.
    docToPlainText(before).trim() === docToPlainText(after).trim() &&
    docTitle(before) === docTitle(after) &&
    collectMediaRefs(before).join('\n') === collectMediaRefs(after).join('\n')
  )
}

function nodeText(node: DocNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  // Anchor-carried wording belongs to the child entry that proposed it, not to this document's
  // author. See ANCHOR_INSERT_NODE above: this line is why an anchor is non-destructive.
  if (node.type === ANCHOR_INSERT_NODE) return ''

  const children = node.content ?? []
  if (children.length === 0) return ''

  // A paragraph's children run together on one line; a list's children each start their own.
  const inline = children.every((child) => INLINE_NODES.has(child.type))
  return children.map(nodeText).join(inline ? '' : '\n')
}

function walk(node: DocNode, visit: (node: DocNode) => void): void {
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}

function isEntryDocument(value: unknown): value is EntryDocument {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<EntryDocument>
  return candidate.type === 'doc' && Array.isArray(candidate.content)
}

/** A blank body to start a session in. `isEmptyDocument` still reports this as empty. */
export function emptyDocument(): EntryDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}
