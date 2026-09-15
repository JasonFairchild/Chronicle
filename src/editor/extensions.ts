import { Extension, mergeAttributes, Mark, Node, type Extensions } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK, MEDIA_NODE } from '@/domain/entryDocument'
import AnchorInsertView from './AnchorInsertView.vue'
import { addAnchorMark, createAnchorInsertStorage, isAnchorEdit } from './anchorCommands'

/**
 * The editor schema: node and mark types, and the extensions list assembled from them. This is the
 * entry **body** only — a title is a separate input that `entryDocument.ts` joins in — so there's no
 * title node here.
 * `entryDocument.ts` reads what this produces as plain JSON, which is what keeps the flattening
 * pure and node-testable. `anchorCommands.ts` is this module's companion — the imperative commands
 * and queries that operate on an editor already built from this schema, kept separate so each file
 * answers one question: what an anchor *is* (here) versus what a session *does* with one (there).
 */

// An image whose bytes live in the media store, referenced by blob id only — no data/object URL or
// path — so `media_refs` can be derived from the document and a reload never finds a dead URL.
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

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
})

/**
 * A span anchor: one child entry's comment or strike, living in the **parent's** document as a mark
 * on the text it is about.
 *
 * `inclusive: false` so typing at an edge isn't silently absorbed into the anchor. `excludes: ''`
 * lets anchors overlap — two children may point at the same sentence, and a mark excludes itself by
 * default, which would let the second anchor replace the first. The unique `anchorId` is also what
 * stops ProseMirror from merging adjacent anchors into one.
 *
 * No color attribute: color is computed at render time from the scheme in force (ENTRY_MODEL.md, "Color").
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
 * A collapsed anchor: wording a child entry proposes, at a position in the parent's document. A
 * node rather than a mark, since a mark can't exist at a zero-width position or carry content; an
 * atom so the wording is placed and removed whole, not typed character by character — the typing
 * happens in `AnchorInsertView.vue`'s own `<input>`, in the session that placed it. That's also what
 * seals it for a *different* editor reading it later (a text-mode revision, another session on the
 * same parent): it belongs to the child that proposed it, not to that editor's contenteditable.
 * `docToPlainText` skips it either way, keeping the anchor non-destructive despite holding text.
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

  // The wording sits in its own inner span, separate from the `<ins>` wrapper, so the dormant
  // interlinear presentation (`DocumentEditor.vue`) can later raise it above the line with a
  // baseline caret — a CSS `::before` on the `<ins>`, not a DOM node, so it never reaches
  // `textContent`, a copy, or `parseHTML` above, which keeps finding the nested span's text.
  renderHTML({ node, HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, { class: 'chronicle-anchor-insert' }),
      ['span', { class: 'chronicle-anchor-wording' }, String(node.attrs.text ?? '')],
    ]
  },

  // Which anchor's wording is open for editing — UI state, never a node attribute, so it can't
  // reach the stored document. See `AnchorInsertStorage` (`anchorCommands.ts`) for why it needs a `Ref`.
  addStorage: createAnchorInsertStorage,

  // The Vue node view (`AnchorInsertView.vue`) renders this node as plain text or a live input
  // depending on this storage — one mechanism replacing the old toolbar-and-field split.
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
  ]
}

/**
 * Anchor mode's own extension: the guard that keeps the two creation experiences from mixing, plus
 * the keyboard shortcuts that are now this mode's first-class entry point since the fixed toolbar is
 * gone. Named for both jobs since it no longer only guards.
 *
 * The guard installs `isAnchorEdit` (`anchorCommands.ts`) as a ProseMirror plugin's
 * `filterTransaction` — which lives on a plugin spec, not on the `EditorProps` TipTap types for
 * DOM-facing options, hence its own one-plugin extension. That's what makes "the two experiences
 * can't mix" a property of the editor, not a rule the UI is trusted to follow: in anchor mode only
 * the anchor commands and undoing them may produce a step; everything else is rejected first.
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
