import { Extension, mergeAttributes, Mark, Node, type Extensions } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { anchorIdsIn } from '@/domain/anchors'
import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  MEDIA_NODE,
  type EntryDocument,
} from '@/domain/entryDocument'
import AnchorInsertView from './AnchorInsertView.vue'
import {
  createAnchorInsertStorage,
  createAnchorModeStorage,
  isAnchorEdit,
  markAnchor,
  type AnchorModeStorage,
} from './anchorCommands'

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
 * overrides a mark type's default of excluding itself — without it, adding this mark somewhere would
 * silently strip any *other* anchor's mark already sitting in that span, since ProseMirror's default
 * `addMark` behavior treats two marks of the same type as mutually exclusive regardless of their
 * attrs. Anchors are kept from actually overlapping at the command level instead (`markAnchor`,
 * `editor/anchorCommands.ts`; PRODUCT.md §4.4): a fresh selection touching an existing anchor's
 * marked passage, sealed or this session's own, never places a new one over it. The unique `anchorId`
 * is what stops ProseMirror from merging adjacent anchors into one.
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
  /**
   * The document as it stood when this **session** began — a resumed draft's
   * `Draft.parent_base_content`. Omitted for a fresh session, where the document the editor opens
   * with is already that base. Every anchor it carries belongs to an earlier, already-sealed child;
   * everything that appears afterward is this session's own. See ENTRY_MODEL.md, "Drafts".
   */
  baseContent?: string
}

export function entryExtensions({
  anchorMode = false,
  baseContent,
}: EntryExtensionOptions = {}): Extensions {
  return [
    StarterKit,
    MediaImage,
    // Installed in every editor, not only anchor-mode ones: a text-mode revision has to be able to
    // read, render, and carry forward the anchors already in the document it is editing.
    Anchor,
    AnchorInsert,
    ...(anchorMode ? [AnchorMode.configure({ baseContent })] : []),
  ]
}

/**
 * Installs `isAnchorEdit` (`anchorCommands.ts`) as a ProseMirror plugin's `filterTransaction` —
 * which lives on a plugin spec, not on the `EditorProps` TipTap types for DOM-facing options, hence
 * its own one-plugin extension. That's what makes "the two experiences can't mix" a property of the
 * editor, not a rule the UI is trusted to follow: in anchor mode only the anchor commands and
 * undoing them may produce a step; everything else is rejected first.
 *
 * Also where "which anchors may still be edited" lives (`AnchorModeStorage`, `anchorCommands.ts`):
 * seeded once, on creation, with every anchor the session's base document already carried. Falling
 * back to the mounted document is right for a fresh session and wrong for a resumed one, which is
 * exactly why a resumed draft passes its own base rather than letting the editor assume one.
 */
const AnchorMode = Extension.create<{ baseContent?: string }, AnchorModeStorage>({
  name: 'anchorMode',
  addOptions() {
    return { baseContent: undefined }
  },
  addStorage: createAnchorModeStorage,
  onCreate() {
    const base = this.options.baseContent ?? (this.editor.getJSON() as EntryDocument)
    this.storage.sealedAnchorIds = new Set(anchorIdsIn(base))
  },
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: isAnchorEdit })]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-h': () => markAnchor(this.editor, 'comment') !== null,
      'Mod-Alt-s': () => markAnchor(this.editor, 'strike') !== null,
    }
  },
})

export { Anchor, AnchorInsert, MediaImage }
