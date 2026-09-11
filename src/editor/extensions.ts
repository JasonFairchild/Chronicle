import { mergeAttributes, Node, type Extensions } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import { Placeholder } from '@tiptap/extensions'
import type { ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { MEDIA_NODE, TITLE_NODE } from '@/domain/entryDocument'

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

export interface EntryExtensionOptions {
  /** True for a root entry's editor, false for a child entry or a revision. */
  withTitle?: boolean
}

export function entryExtensions({ withTitle = false }: EntryExtensionOptions = {}): Extensions {
  return [
    withTitle ? TitledDocument : BodyDocument,
    ...(withTitle ? [Title] : []),
    // StarterKit ships its own Document; ours replaces it so the title has somewhere to sit.
    StarterKit.configure({ document: false }),
    MediaImage,
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

export { MediaImage, Title }
