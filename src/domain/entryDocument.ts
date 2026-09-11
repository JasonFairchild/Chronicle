/**
 * The document layer: one canonical way to turn an entry's stored `content` into plain text.
 *
 * `Entry.content` is a serialized ProseMirror document. Search, timeline previews, anchor offsets,
 * and diffs all need the same flat string, and they must agree to the character — an anchor
 * recorded against one flattening and resolved against another silently points at the wrong words.
 * So there is exactly one function that does it, `docToPlainText`, and everything calls it.
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

/** The optional first node of a root entry's document. Child entries and revisions omit it. */
export const TITLE_NODE = 'title'

/** An image whose bytes live in the media store; the node carries only the blob's id. */
export const MEDIA_NODE = 'mediaImage'

/** Nodes that sit inside a line rather than starting one. */
const INLINE_NODES = new Set(['text', 'hardBreak'])

/**
 * Reads stored content as a document.
 *
 * A string that is not a serialized document is treated as one paragraph per line. That is what
 * every entry written before the editor existed looks like, and it means old rows keep working
 * without a migration pass over the database.
 */
export function parseDocument(content: string | EntryDocument): EntryDocument {
  if (typeof content !== 'string') return content

  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isEntryDocument(parsed)) return parsed
    } catch {
      // Not JSON after all, so it is prose that happens to start with a brace.
    }
  }

  return plainTextDocument(content)
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
 * The canonical flattening: the document's body as plain text, one line per block.
 *
 * The title node is deliberately excluded. Anchors are offsets into this string, and a title is
 * not something a reader selects and annotates; including it would also shift every body anchor
 * the moment a title changed. `docTitle` is how the title is read instead.
 */
export function docToPlainText(content: string | EntryDocument): string {
  const doc = parseDocument(content)

  return doc.content
    .filter((node) => node.type !== TITLE_NODE)
    .map(nodeText)
    .join('\n')
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

/**
 * Whether stored content is a real serialized document rather than legacy plain text.
 *
 * The distinction matters exactly once, when a revision decides where its `media_refs` come from.
 * A document knows which blobs it depends on, so it is the authority; plain text knows nothing, so
 * the previous version's list has to be carried forward instead of being derived away to nothing.
 */
export function isSerializedDocument(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return false

  try {
    return isEntryDocument(JSON.parse(trimmed))
  } catch {
    return false
  }
}

/**
 * A blank document to start a session in.
 *
 * The title node is optional in the schema, and an optional node is one the editor will never
 * create on its own — so a root entry's editor has to be handed an empty title to type into, or
 * naming an entry would be impossible. `isEmptyDocument` still reports this as empty.
 */
export function emptyDocument(withTitle = false): EntryDocument {
  const heading: DocNode[] = withTitle ? [{ type: TITLE_NODE }] : []
  return { type: 'doc', content: [...heading, { type: 'paragraph' }] }
}

/**
 * Guarantees a document has a title node to type into.
 *
 * The schema makes the title optional, and an optional node is one the editor will never create on
 * its own. Without this, an entry written before the editor existed — or any document that simply
 * never had a title — could never be given one, so renaming would be impossible for exactly the
 * entries most likely to need it.
 */
export function ensureTitle(doc: EntryDocument): EntryDocument {
  if (doc.content.some((node) => node.type === TITLE_NODE)) return doc

  return { ...doc, content: [{ type: TITLE_NODE }, ...doc.content] }
}
