/**
 * The document layer: one canonical way to turn an entry's stored `content` into plain text.
 *
 * `Entry.content` is a serialized ProseMirror document. Search, timeline previews, and diffs all
 * need the same flat string and must agree to the character, so exactly one function produces it —
 * `docToPlainText` — and everything calls it (CLAUDE.md, Landmarks).
 *
 * Nothing here imports TipTap. The flattening is a walk over plain JSON, which keeps it pure,
 * runnable in node, and independent of whichever editor sits on top.
 */

import { collectAnchors, type DocumentAnchor } from './anchors'

/** A ProseMirror mark as it serializes to JSON. */
export interface DocMark {
  type: string
  attrs?: Record<string, unknown>
}

/** A ProseMirror node as it serializes to JSON. Structural only; the editor owns the schema. */
export interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: DocMark[]
}

export interface EntryDocument extends DocNode {
  type: 'doc'
  content: DocNode[]
}

/** An image whose bytes live in the media store; the node carries only the blob's id. */
export const MEDIA_NODE = 'mediaImage'

/** A span anchor: a mark on the parent's own text. Metadata riding on text already there. */
export const ANCHOR_MARK = 'anchor'

/**
 * A collapsed anchor: wording a child entry proposes, as a node rather than a mark.
 *
 * Being a node it holds real text that the flattening **must** skip, which is what makes "no child
 * entry is destructive" checkable rather than merely intended: an anchor-mode session leaves
 * `docToPlainText` untouched, so `sameContent(before, after)` holds by construction.
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
export function plainTextDocument(text: string): EntryDocument {
  const paragraphs = text.split('\n').map((line): DocNode => {
    return line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  })

  return { type: 'doc', content: paragraphs }
}

/**
 * Plain text as stored content — the one named way to build a document from a bare string, for the
 * store's simple non-session creation methods and for tests that don't care about rich formatting.
 * A title is never part of it: a title is a sibling field on the entry (ENTRY_MODEL.md, "Fields").
 */
export function textContent(body: string): string {
  return serializeDocument(plainTextDocument(body))
}

/**
 * The canonical flattening: the document's body as plain text, one line per block. Anchor-carried
 * wording is excluded — see `nodeText` — and nothing else is.
 */
export function docToPlainText(content: string | EntryDocument): string {
  const doc = parseDocument(content)

  return doc.content.map(nodeText).join('\n')
}

/**
 * A document's body as one line, trimmed to `limit`, for a card, a list row, or a picker label.
 *
 * `limit` is all call sites disagree on: a timeline card has a paragraph's worth of room, a picker
 * option has part of a line. An empty document previews as the empty string rather than inventing a
 * name for itself, leaving the caller to supply wording that fits where it is being shown.
 */
export function previewText(content: string | EntryDocument, limit = 160): string {
  const singleLine = docToPlainText(content).replace(/\s+/g, ' ').trim()
  return singleLine.length > limit ? `${singleLine.slice(0, limit - 3)}...` : singleLine
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

/** True when there is nothing worth saving in the document itself: no body text and no media. */
export function isEmptyDocument(content: string | EntryDocument): boolean {
  const doc = parseDocument(content)

  return docToPlainText(doc).trim() === '' && collectMediaRefs(doc).length === 0
}

/**
 * True when there is nothing worth saving anywhere an entry keeps text — the document plus the
 * title beside it. `title` is trimmed the same way a stored one would be, so whitespace typed and
 * abandoned in the field doesn't count as a name any more than it would count as body text.
 */
export function isEmptyEntry(content: string | EntryDocument, title: string | null): boolean {
  return isEmptyDocument(content) && !title?.trim()
}

/** What changed between two documents, measured as outcomes rather than as editor operations. */
export interface ContentDelta {
  sameText: boolean
  sameMedia: boolean
  /** Same anchor ids and kinds. Ignores wording text — see `contentDelta`. */
  sameAnchors: boolean
}

/**
 * Compares two documents along the three axes a change's signals are read from, in one pass so
 * `DocumentEditor` never has to re-walk the document per signal.
 *
 * Deliberately a comparison of outcomes rather than a list of editor operations. Marks arrive as
 * `addMark`/`removeMark`, but alignment and spacing arrive as attribute steps, wrapping a paragraph
 * in a list arrives as a `replaceAround` that no step type distinguishes from a real edit, and an
 * anchor command produces ordinary-looking mark/node steps too — no step type is reliable, but what
 * the document says before and after always is.
 *
 * `sameAnchors` compares only `anchor_id` and `kind` (`collectAnchors`, `@/domain/anchors`),
 * ignoring `quote`/`insertion`: retyping a wording box moves no anchor and covers no different text,
 * so it must read as ordinary typing, not as a structural anchor op.
 */
export function contentDelta(a: string | EntryDocument, b: string | EntryDocument): ContentDelta {
  const before = parseDocument(a)
  const after = parseDocument(b)

  return {
    // Trimmed, as `isEmptyDocument` trims: the editor keeps an empty paragraph at the end of a
    // document so there is always somewhere to click, and appends one when the last block becomes
    // a heading. That scaffolding is the editor's, not the author's, and counting it would report
    // every heading as an edit.
    sameText: docToPlainText(before).trim() === docToPlainText(after).trim(),
    sameMedia: collectMediaRefs(before).join('\n') === collectMediaRefs(after).join('\n'),
    sameAnchors: anchorKey(collectAnchors(before)) === anchorKey(collectAnchors(after)),
  }
}

/**
 * True when two documents say the same thing: the same body text and the same attachments. Only
 * their presentation differs. The title lives beside the document rather than in it, so a caller
 * comparing a full entry's before and after must check it separately.
 */
export function sameContent(a: string | EntryDocument, b: string | EntryDocument): boolean {
  const delta = contentDelta(a, b)
  return delta.sameText && delta.sameMedia
}

function anchorKey(anchors: DocumentAnchor[]): string {
  return anchors
    .map((anchor) => `${anchor.anchor_id}:${anchor.kind ?? ''}`)
    .sort()
    .join('\n')
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
