// The editor schema: node and mark types, and the extensions list assembled from them.
//
// The entry **body** only. A title is an ordinary `<input>` beside the editing surface and a plain
// field on the entry, so no title node exists here or in the stored document (ENTRY_MODEL.md,
// "Fields"). `entryDocument.ts` reads what this produces as plain JSON, which is what keeps the
// flattening pure and node-testable. `anchorCommands.ts` is this module's companion, kept separate
// so each file answers one question: what an anchor *is* (here) versus what a session *does* with
// one (there).

import { Extension, type Extensions, Mark, mergeAttributes, Node } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'

import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  ANCHOR_WORDING_MARK,
  type EntryDocument,
  MEDIA_NODE,
  parseDocument,
} from '@/domain/entryDocument'

import {
  anchorModeDecorations,
  applyAnchorKind,
  markTyped,
  pasteAsLine,
  routeClickOnPassage,
  routeTypingOnPassage,
  SEALED_ANCHORS,
} from './anchorCommands'
import { allowsEdit, sealAnchors } from './anchorGuard'

/**
 * An image whose bytes live in the media store, referenced by blob id only — no data/object URL or
 * path — so `media_refs` can be derived from the document and a reload never finds a dead URL.
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

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
})

/**
 * A span anchor: one related entry's comment or strike, living in the **parent's** document as a
 * mark on the text it is about.
 *
 * `inclusive: false` so typing at an edge isn't silently absorbed into the anchor. `excludes: ''`
 * overrides a mark type's default of excluding itself — without it, adding this mark somewhere would
 * silently strip any *other* anchor's mark already sitting in that span, since ProseMirror treats
 * two marks of the same type as mutually exclusive regardless of their attrs. Anchors are kept from
 * actually overlapping at the command level instead (`markAnchor`, `anchorCommands.ts`). The unique
 * `anchorId` is what stops ProseMirror from merging adjacent anchors into one.
 *
 * No color attribute: color is computed at render time (ENTRY_MODEL.md, "Color").
 *
 * `clearable: false` keeps Clear formatting (`unsetAllMarks`) from removing it: an anchor isn't
 * formatting, and only the anchor controls may take one away.
 */
const Anchor = Mark.create({
  name: ANCHOR_MARK,
  inclusive: false,
  excludes: '',
  clearable: false,

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
 * Wording a related entry proposes, as text in the parent's document (`ANCHOR_WORDING_MARK`,
 * `domain/entryDocument.ts`).
 *
 * Excludes every mark, itself included, so wording carries no passage and no formatting: bold over
 * it leaves it as it was, and marking text as wording strips whatever it inherited. `inclusive` and
 * `clearable` are false for the passage mark's reasons.
 */
const AnchorWording = Mark.create({
  name: ANCHOR_WORDING_MARK,
  inclusive: false,
  excludes: '_',
  clearable: false,

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-anchor-id'),
        renderHTML: (attributes) =>
          attributes.anchorId ? { 'data-anchor-id': attributes.anchorId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'ins[data-anchor-id]' }]
  },

  /**
   * The wording sits in its own inner span, apart from the `<ins>`, so the parked interlinear
   * presentation (`DocumentEditor.vue`) can raise it above a proofreader's caret mark (⌃) on the
   * baseline. The mark is a CSS `::before` on the `<ins>`, not a DOM node, so ProseMirror never
   * reads it back as typed wording, and a copy never carries it.
   */
  renderHTML({ HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, { class: 'chronicle-anchor-insert' }),
      ['span', { class: 'chronicle-anchor-wording' }, 0],
    ]
  },
})

/**
 * The same wording as an atom carrying it in a `text` attribute, which the editor no longer writes.
 * `docToPlainText` skips it, keeping the anchor non-destructive despite holding text.
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

  // No `parseHTML`: the `<ins>` it renders is the wording mark's, and ProseMirror re-reads typed
  // wording from the DOM by that rule.

  /** The wording mark's `<ins><span>` shape, so the same CSS styles both. */
  renderHTML({ node, HTMLAttributes }) {
    return [
      'ins',
      mergeAttributes(HTMLAttributes, { class: 'chronicle-anchor-insert' }),
      ['span', { class: 'chronicle-anchor-wording' }, String(node.attrs.text ?? '')],
    ]
  },
})

/** `fragment` with no anchor marks, its nodes' content included. */
function withoutAnchorMarks(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    const marks = node.marks.filter(
      (mark) => mark.type.name !== ANCHOR_MARK && mark.type.name !== ANCHOR_WORDING_MARK,
    )
    nodes.push(
      node.isText ? node.mark(marks) : node.copy(withoutAnchorMarks(node.content)).mark(marks),
    )
  })
  return Fragment.from(nodes)
}

/**
 * The guard (`anchorGuard.ts`) in every editor, as a plugin whose state is its snapshot: the
 * anchors of the document the editor opens with, or of `baseContent` when given.
 *
 * Paste and drop strip anchor marks, so a copy of anchored text or wording never carries its
 * `anchorId` somewhere new. Nothing else stops a new anchor: the guard only keeps sealed ones.
 */
const AnchorGuard = Extension.create<{
  anchorMode: boolean
  baseContent: string | EntryDocument | undefined
}>({
  name: 'anchorGuard',
  addOptions() {
    return { anchorMode: false, baseContent: undefined }
  },
  addProseMirrorPlugins() {
    const { anchorMode, baseContent } = this.options
    return [
      new Plugin({
        key: SEALED_ANCHORS,
        state: {
          init: (_config, state) =>
            sealAnchors(
              baseContent === undefined
                ? state.doc
                : state.schema.nodeFromJSON(parseDocument(baseContent)),
            ),
          apply: (_transaction, sealed) => sealed,
        },
        filterTransaction: (transaction, state) =>
          allowsEdit(transaction, SEALED_ANCHORS.getState(state)!, anchorMode),
        props: {
          transformPasted: (slice) =>
            new Slice(withoutAnchorMarks(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ]
  },
})

/**
 * Anchor mode's typing (`anchorCommands.ts`): typed text becomes wording, a paste is typed as one
 * line, a drop is ignored, and typing or a click on the session's own passage goes to the end of
 * its wording.
 */
const AnchorMode = Extension.create({
  name: 'anchorMode',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, state) => markTyped(transactions, state),
        props: {
          handleTextInput: routeTypingOnPassage,
          handlePaste: (view, _event, slice) => pasteAsLine(view, slice),
          handleDrop: () => true, // Inside a passage it would split it, and paste does its job.
          handleClick: (_view, pos) => routeClickOnPassage(editor, pos),
          decorations: anchorModeDecorations,
        },
      }),
    ]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-h': () => applyAnchorKind(this.editor, 'comment'),
      'Mod-Alt-s': () => applyAnchorKind(this.editor, 'strike'),
    }
  },
})

export interface EntryExtensionOptions {
  /** True for an anchor-mode session: the guard lets only typing wording and anchor commands by. */
  anchorMode?: boolean
  /**
   * The document whose anchors the guard seals, when not the one the editor opens with. In anchor
   * mode, the document as it stood when this **session** began — for a resumed draft, the version
   * `Draft.parent.base_version_id` names — so the anchors placed since are this session's own. See
   * AUTHORING.md, "Drafts".
   */
  baseContent?: string | EntryDocument
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
    AnchorWording,
    AnchorInsert,
    AnchorGuard.configure({ anchorMode, baseContent }),
    ...(anchorMode ? [AnchorMode] : []),
  ]
}
