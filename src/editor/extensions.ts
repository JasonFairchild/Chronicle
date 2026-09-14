import { Extension, mergeAttributes, Mark, Node, type Extensions } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { Plugin } from '@tiptap/pm/state'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK, MEDIA_NODE } from '@/domain/entryDocument'
import AnchorInsertView from './AnchorInsertView.vue'
import { addAnchorMark, createAnchorInsertStorage, isAnchorEdit } from './anchorCommands'

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
 * content of its own. An atom so the wording is placed and removed whole rather than typed into
 * character by character the way ordinary text is — `AnchorInsertView.vue`'s own `<input>` is where
 * the actual typing happens, in the session that placed it. What this really defends is a *sealed*
 * insert read in a different editor later — a text-mode revision rendering it, or another session
 * opening the same parent — where it belongs to the child that proposed it and is not something that
 * editor's own contenteditable can reach into. `docToPlainText` skips it either way, which is what
 * keeps an anchor non-destructive even though this node really does hold text.
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

  // The wording sits in its own inner span, separate from the `<ins>` wrapper — CSS positions the
  // span inline today, with the dormant interlinear presentation (`DocumentEditor.vue`) able to
  // raise it above the line, with a caret glyph on the baseline marking the insertion point,
  // without a markup change. That caret is a CSS `::before` on the `<ins>` rather than a DOM node
  // (and only rendered in interlinear mode — an inline caret would point at nothing), so it never
  // reaches `textContent`, a copy, or `parseHTML` above — which keeps reading `element.textContent`
  // and finds the nested span's text the same way it always found the flat text.
  renderHTML({ node, HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, { class: 'chronicle-anchor-insert' }),
      ['span', { class: 'chronicle-anchor-wording' }, String(node.attrs.text ?? '')],
    ]
  },

  // Which anchor's wording is open for editing right now — UI state, never a node attribute, so it
  // can never reach the stored document. See `AnchorInsertStorage` (`anchorCommands.ts`) for why
  // this has to be a `Ref` rather than a plain field.
  addStorage: createAnchorInsertStorage,

  // The Vue node view (`AnchorInsertView.vue`) is what gives committed and open wording one
  // mechanism: the same node renders as plain text or as a live input depending on this storage,
  // rather than the toolbar-and-field split the anchor menu replaces (Piece 1).
  addNodeView() {
    return VueNodeViewRenderer(AnchorInsertView)
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
    ...(anchorMode ? [AnchorMode] : []),
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
 * Anchor mode's own extension: the guard that keeps the two creation experiences from mixing, plus
 * the keyboard shortcuts that are now this mode's first-class entry point now that the fixed toolbar
 * is gone (Piece 1, "Accessibility — the real cost of this change"). Named for both jobs since it no
 * longer only guards.
 *
 * The guard installs `isAnchorEdit` (`anchorCommands.ts`) as a ProseMirror plugin's
 * `filterTransaction`, which lives on a plugin spec rather than on `EditorProps` — the DOM-facing
 * options (`handleKeyDown` and friends) TipTap types there — so it needs its own one-plugin extension
 * rather than a prop `useEditor` would accept directly. This is what makes "the two creation
 * experiences cannot be mixed" a property of the editor rather than a rule the UI is trusted to
 * follow: in anchor mode the only transactions that may change the document are the anchor commands
 * and undoing them, everything else rejected before it produces a step.
 */
const AnchorMode = Extension.create({
  name: 'anchorMode',
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: isAnchorEdit })]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-h': () => addAnchorMark(this.editor, 'comment') !== null,
      'Mod-Alt-s': () => addAnchorMark(this.editor, 'strike') !== null,
    }
  },
})

export { Anchor, AnchorInsert, MediaImage }
