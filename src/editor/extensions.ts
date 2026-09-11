import { Extension, mergeAttributes, Mark, Node, type Editor, type Extensions } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import { Placeholder } from '@tiptap/extensions'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
import StarterKit from '@tiptap/starter-kit'
import { newAnchorId } from '@/domain/anchors'
import type { AnchorMapping } from '@/domain/anchorWarnings'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK, MEDIA_NODE, TITLE_NODE } from '@/domain/entryDocument'
import type { AnchorKind } from '@/types/entry'

/**
 * The editor schema. This is the only module that knows TipTap exists; `entryDocument.ts` reads
 * what this produces as plain JSON, which is what keeps the flattening pure and node-testable.
 */

/**
 * A root entry's document: an optional title, then a body.
 *
 * The title lives inside the document rather than beside it, so renaming an entry is an ordinary
 * document step that lands in the authoring trace for free. `Entry.title` is only a cache of this
 * node, written at save time so timelines and search never have to parse a document.
 */
const TitledDocument = Document.extend({
  name: 'doc',
  content: `${TITLE_NODE}? block+`,
})

/** Child entries and revisions carry no title: the title belongs to the entry being read. */
const BodyDocument = Document.extend({
  name: 'doc',
  content: 'block+',
})

/**
 * Deliberately not in the `block` group. If it were, `title? block+` would happily accept a second
 * title further down the document, and the "one title, first" rule would live in the UI instead of
 * in the schema where it can actually be enforced.
 */
const Title = Node.create({
  name: TITLE_NODE,
  content: 'text*',
  marks: '',
  defining: true,
  // Above StarterKit's, so the Enter below is reached before the default block-splitting one.
  priority: 1000,

  parseHTML() {
    return [{ tag: 'h1[data-title]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['h1', mergeAttributes(HTMLAttributes, { 'data-title': '' }), 0]
  },

  addKeyboardShortcuts() {
    const isTitle = (position: ResolvedPos) => position.parent.type.name === this.name

    return {
      /**
       * A title is one line, so Enter moves into the body rather than splitting the heading. The
       * body always exists, because the schema requires at least one block after the title.
       *
       * Both ends of the selection are checked, not just the caret: select the whole document and
       * press Enter and the default handler would try to split across the title boundary, which is
       * invalid against this schema and throws rather than failing quietly. Returning true here is
       * what stops that handler from running at all.
       */
      Enter: () =>
        this.editor.commands.command(({ tr, state, dispatch }) => {
          const { $anchor, $head } = state.selection
          if (!isTitle($anchor) && !isTitle($head)) return false

          if (dispatch) {
            tr.deleteSelection()
            const head = tr.selection.$head
            const target = isTitle(head) ? head.after() + 1 : head.pos
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(Math.min(target, tr.doc.content.size))),
            )
            tr.scrollIntoView()
          }

          return true
        }),
    }
  },
})

/**
 * An image whose bytes live in the media store. The node carries the blob's id and nothing else:
 * no data URL, no object URL, no path. That is what lets `media_refs` be derived from the document,
 * and it keeps a stored entry from embedding a URL that stops resolving the moment the page reloads.
 */
const MediaImage = Node.create({
  name: MEDIA_NODE,
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      mediaRef: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-ref'),
        renderHTML: (attributes) =>
          attributes.mediaRef ? { 'data-media-ref': attributes.mediaRef } : {},
      },
      alt: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-media-ref]' }]
  },

  // No `src`: the bytes are resolved to an object URL at render time by whoever is displaying the
  // document, which is presentation and has no business being stored in the content.
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
})

/**
 * A span anchor: one child entry's comment or strike, living in the **parent's** document as a mark
 * on the text it is about.
 *
 * `inclusive: false` so typing at either edge is not silently absorbed into the anchor — an anchor
 * covers the passage someone chose, not whatever grows next to it later.
 *
 * `excludes: ''` because anchors overlap freely: two children may have something to say about the
 * same sentence, and a mark type excludes itself by default, which would make the second anchor
 * replace the first. The unique `anchorId` is also what stops ProseMirror from merging two adjacent
 * anchors into one, since marks only merge when their attributes are equal.
 *
 * No colour attribute. Colour is computed at render time from the scheme in force, so changing
 * schemes never rewrites history (ENTRY_MODEL.md, "Colour").
 */
const Anchor = Mark.create({
  name: ANCHOR_MARK,
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-anchor-id'),
        renderHTML: (attributes) =>
          attributes.anchorId ? { 'data-anchor-id': attributes.anchorId } : {},
      },
      kind: {
        default: 'comment',
        parseHTML: (element) => element.getAttribute('data-anchor-kind'),
        renderHTML: (attributes) => ({ 'data-anchor-kind': attributes.kind }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-anchor-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'chronicle-anchor' }), 0]
  },
})

/**
 * A collapsed anchor: wording a child entry proposes, at a position in the parent's document.
 *
 * A node rather than a mark because a mark cannot exist at a zero-width position, let alone carry
 * content of its own. An atom so the wording is placed and removed whole and can never be typed
 * into — it belongs to the child that proposed it, and the parent's editor is not where it gets
 * revised. `docToPlainText` skips it, which is what keeps an anchor non-destructive even though
 * this node really does hold text.
 */
const AnchorInsert = Node.create({
  name: ANCHOR_INSERT_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-anchor-id'),
        renderHTML: (attributes) =>
          attributes.anchorId ? { 'data-anchor-id': attributes.anchorId } : {},
      },
      text: {
        default: '',
        parseHTML: (element) => element.textContent,
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'ins[data-anchor-id]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, { class: 'chronicle-anchor-insert' }),
      String(node.attrs.text ?? ''),
    ]
  },
})

export interface EntryExtensionOptions {
  /** True for a root entry's editor, false for a child entry or a revision. */
  withTitle?: boolean
  /** True for an anchor-mode session: installs the guard that blocks every other kind of edit. */
  anchorMode?: boolean
}

export function entryExtensions({
  withTitle = false,
  anchorMode = false,
}: EntryExtensionOptions = {}): Extensions {
  return [
    withTitle ? TitledDocument : BodyDocument,
    ...(withTitle ? [Title] : []),
    // StarterKit ships its own Document; ours replaces it so the title has somewhere to sit.
    StarterKit.configure({ document: false }),
    MediaImage,
    // Installed in every editor, not only anchor-mode ones: a text-mode revision has to be able to
    // read, render, and carry forward the anchors already in the document it is editing.
    Anchor,
    AnchorInsert,
    ...(anchorMode ? [AnchorModeGuard] : []),
    // Shown on every empty text block, not only the focused one: a blank title stays visibly a
    // title whether or not the caret is in it, since a person may leave it untitled on purpose.
    Placeholder.configure({
      showOnlyCurrent: false,
      placeholder: ({ node }) => {
        if (node.type.name === TITLE_NODE) return 'Title'
        if (node.type.name === 'paragraph') return 'Record your thoughts…'
        return ''
      },
    }),
  ]
}

/**
 * Marks a transaction as one of this module's anchor commands, which is what `isAnchorEdit` lets
 * through in anchor mode.
 */
const ANCHOR_EDIT_META = 'chronicleAnchorEdit'

/** prosemirror-history's own plugin key, so undo and redo are recognisable to the guard below. */
const HISTORY_META = 'history$'

/**
 * The anchor-mode guard.
 *
 * This is what makes "the two creation experiences cannot be mixed" a property of the editor rather
 * than a rule the UI is trusted to follow: in anchor mode the only transactions that may change the
 * document are the anchor commands below and undoing them. Everything else — typing, pasting,
 * formatting, dropping an image — is rejected before it produces a step, so an anchor-mode session
 * cannot alter a single word of its parent.
 */
export function isAnchorEdit(transaction: Transaction): boolean {
  return (
    transaction.steps.length === 0 ||
    transaction.getMeta(ANCHOR_EDIT_META) === true ||
    transaction.getMeta(HISTORY_META) !== undefined
  )
}

/**
 * Installs `isAnchorEdit` as a ProseMirror plugin's `filterTransaction`.
 *
 * `filterTransaction` lives on a plugin spec, not on `EditorProps` — the DOM-facing options
 * (`handleKeyDown` and friends) TipTap types there — so the guard needs its own one-plugin
 * extension rather than a prop `useEditor` would accept directly.
 */
const AnchorModeGuard = Extension.create({
  name: 'anchorModeGuard',
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: isAnchorEdit })]
  },
})

/**
 * Marks the current selection as an anchor and returns its new id, or null when there is nothing
 * selected to mark.
 */
export function addAnchorMark(editor: Editor, kind: AnchorKind): string | null {
  const { state } = editor
  const { from, to, empty } = state.selection
  const markType = state.schema.marks[ANCHOR_MARK]
  if (empty || !markType) return null

  const anchorId = newAnchorId()
  const transaction = state.tr.addMark(from, to, markType.create({ anchorId, kind }))

  dispatchAnchorEdit(editor, transaction)
  return anchorId
}

/**
 * Places proposed wording at the caret, or at the end of the current selection.
 *
 * Passing the `anchorId` of a strike is what declares the two to be one replacement gesture — the
 * shape that used to be guessed from how close a strike and an insert happened to land.
 */
export function addAnchorInsert(editor: Editor, text: string, anchorId?: string): string | null {
  const { state } = editor
  const nodeType = state.schema.nodes[ANCHOR_INSERT_NODE]
  if (!nodeType || !text) return null

  const id = anchorId ?? newAnchorId()
  const transaction = state.tr.insert(state.selection.to, nodeType.create({ anchorId: id, text }))

  dispatchAnchorEdit(editor, transaction)
  return id
}

/** Where one anchor sits in a document, in ProseMirror positions. */
export interface AnchorSpan {
  anchor_id: string
  quote: string
  from: number
  to: number
}

/**
 * The region each anchor occupies, taken as the outermost extent of its pieces.
 *
 * A strike and the wording replacing it are one anchor in two places, adjacent by construction, so
 * one span covering both is the region the anchor is responsible for — and it means deleting the
 * proposed wording counts as disturbing the anchor just as deleting the struck text does.
 */
export function anchorSpans(doc: ProseMirrorNode): AnchorSpan[] {
  const spans = new Map<string, AnchorSpan>()

  const extend = (anchorId: string, from: number, to: number, quote: string) => {
    const existing = spans.get(anchorId)
    if (!existing) {
      spans.set(anchorId, { anchor_id: anchorId, quote, from, to })
      return
    }

    existing.from = Math.min(existing.from, from)
    existing.to = Math.max(existing.to, to)
    existing.quote += quote
  }

  doc.descendants((node, pos) => {
    if (node.type.name === ANCHOR_INSERT_NODE) {
      const anchorId = node.attrs.anchorId
      if (typeof anchorId === 'string' && anchorId) extend(anchorId, pos, pos + node.nodeSize, '')
      return false
    }

    if (!node.isText) return true

    for (const mark of node.marks) {
      if (mark.type.name !== ANCHOR_MARK) continue
      const anchorId = mark.attrs.anchorId
      if (typeof anchorId === 'string' && anchorId) {
        extend(anchorId, pos, pos + node.nodeSize, node.text ?? '')
      }
    }

    return true
  })

  return [...spans.values()]
}

/** One span moved through an edit: the judgment `anchorsAffectedBy` reads, plus where it landed. */
export type MappedAnchorSpan = AnchorMapping & Pick<AnchorSpan, 'from' | 'to'>

/**
 * Moves each span through an edit and reports what that edit did to it, for `anchorsAffectedBy` to
 * judge. Positions come back alongside the judgment, not just the judgment alone, because a
 * revision session runs many edits in sequence and each one has to resume tracking from where the
 * last left off — a caller keeps calling this with the spans it returned, chaining one transaction
 * at a time, rather than trying to compose every step's `Mapping` itself.
 *
 * The endpoints are mapped with opposite biases, matching the mark's `inclusive: false`: text typed
 * at the start stays outside it, text typed at the end likewise, so a pure shift leaves the length
 * alone and only a change *inside* the span moves it.
 */
export function mapAnchorSpans(spans: AnchorSpan[], mapping: Mapping): MappedAnchorSpan[] {
  return spans.map((span) => {
    const start = mapping.mapResult(span.from, 1)
    const end = mapping.mapResult(span.to, -1)
    const from = start.pos
    const to = Math.max(from, end.pos)

    return {
      anchor_id: span.anchor_id,
      quote: span.quote,
      length: span.to - span.from,
      mappedLength: to - from,
      deletedInside: start.deletedAfter || end.deletedBefore,
      from,
      to,
    }
  })
}

function dispatchAnchorEdit(editor: Editor, transaction: Transaction): void {
  transaction.setMeta(ANCHOR_EDIT_META, true)
  editor.view.dispatch(transaction)
}

export { Anchor, AnchorInsert, MediaImage, Title }
