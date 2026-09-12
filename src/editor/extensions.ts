import { Extension, mergeAttributes, Mark, Node, type Extensions } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK, MEDIA_NODE } from '@/domain/entryDocument'
import { isAnchorEdit } from './anchorCommands'

/**
 * The editor schema: node and mark types, and the extensions list assembled from them.
 * `entryDocument.ts` reads what this produces as plain JSON, which is what keeps the flattening
 * pure and node-testable. `anchorCommands.ts` is this module's companion — the imperative commands
 * and queries that operate on an editor already built from this schema, kept separate so each file
 * answers one question: what an anchor *is* (here) versus what a session *does* with one (there).
 */

/**
 * This schema is the **body** only. A titled entry's title is a plain input beside this editor, and
 * `entryDocument.ts` joins the two into the one document that gets stored — so there is no title
 * node here, and nothing in the toolbar, the keyboard shortcuts, the markdown shortcuts, or a paste
 * can reach a title by construction rather than by a guard that has to catch each of them.
 */

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
  /** True for an anchor-mode session: installs the guard that blocks every other kind of edit. */
  anchorMode?: boolean
}

export function entryExtensions({ anchorMode = false }: EntryExtensionOptions = {}): Extensions {
  return [
    StarterKit,
    MediaImage,
    // Installed in every editor, not only anchor-mode ones: a text-mode revision has to be able to
    // read, render, and carry forward the anchors already in the document it is editing.
    Anchor,
    AnchorInsert,
    ...(anchorMode ? [AnchorModeGuard] : []),
    /*
      An invitation to start, so it belongs only where nothing has been started: on the empty body,
      and never on an empty block inside writing that is already under way. Making a heading appends
      an empty paragraph after it, and prompting someone to record their thoughts directly beneath
      the heading they are still typing reads as though the entry were blank.

      `showOnlyCurrent: false` so it is there before the caret is — an empty composer sitting on the
      timeline should say what it is for without being clicked into first.
    */
    Placeholder.configure({
      showOnlyCurrent: false,
      placeholder: ({ editor, node }) =>
        editor.isEmpty && node.type.name === 'paragraph' ? 'Record your thoughts…' : '',
    }),
  ]
}

/**
 * Installs `isAnchorEdit` (`anchorCommands.ts`) as a ProseMirror plugin's `filterTransaction`.
 *
 * `filterTransaction` lives on a plugin spec, not on `EditorProps` — the DOM-facing options
 * (`handleKeyDown` and friends) TipTap types there — so the guard needs its own one-plugin
 * extension rather than a prop `useEditor` would accept directly. This is what makes "the two
 * creation experiences cannot be mixed" a property of the editor rather than a rule the UI is
 * trusted to follow: in anchor mode the only transactions that may change the document are the
 * anchor commands and undoing them, everything else rejected before it produces a step.
 */
const AnchorModeGuard = Extension.create({
  name: 'anchorModeGuard',
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: isAnchorEdit })]
  },
})

export { Anchor, AnchorInsert, MediaImage }
