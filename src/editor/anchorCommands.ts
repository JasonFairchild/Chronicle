import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
import { ref, type Ref } from 'vue'
import { newAnchorId } from '@/domain/anchors'
import type { AnchorMapping } from '@/domain/anchorWarnings'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK } from '@/domain/entryDocument'
import type { AnchorKind } from '@/types/entry'

/**
 * The imperative half of anchor-mode: commands that place or read anchors on an editor that
 * already exists, plus the guard predicate that recognises them. `extensions.ts` is the schema
 * these operate on — a mark and a node type, and the plugin that installs the guard below into an
 * anchor-mode editor — kept separate so each file answers one question: what an anchor *is*
 * (extensions.ts) versus what a session *does* with one (here).
 */

/**
 * Marks a transaction as one of this module's anchor commands, which is what `isAnchorEdit` lets
 * through in anchor mode.
 */
const ANCHOR_EDIT_META = 'chronicleAnchorEdit'

/** prosemirror-history's own plugin key, so undo and redo are recognisable to the guard below. */
const HISTORY_META = 'history$'

/**
 * The anchor-mode guard, installed by `extensions.ts`'s `AnchorMode` plugin.
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
 * What the polite live region in `DocumentEditor` announces after an anchor command runs. Carried
 * on the transaction's own meta rather than returned from the command, so it reaches `onUpdate` —
 * the one place both a button click and a keyboard shortcut (`extensions.ts`) end up — however the
 * command was invoked.
 */
export interface AnchorAnnouncement {
  message: string
}

const ANCHOR_ANNOUNCE_META = 'chronicleAnchorAnnounce'

/** Reads the announcement an anchor command attached to its transaction, if any. */
export function readAnchorAnnouncement(transaction: Transaction): AnchorAnnouncement | null {
  return (transaction.getMeta(ANCHOR_ANNOUNCE_META) as AnchorAnnouncement | undefined) ?? null
}

/**
 * UI state for one `anchorInsert` node view: which anchor's wording input is open, if any. Kept off
 * the node's own attributes — see `extensions.ts`, "Wording: one mechanism, a node view" — so this
 * never becomes part of the stored document. A `Ref` rather than a plain field because a node view
 * mounted by `VueNodeViewRenderer` needs Vue's own reactivity to notice a change here: ProseMirror's
 * view only re-renders a node whose document representation changed, and opening or closing a
 * wording session deliberately produces no such change.
 */
export interface AnchorInsertStorage {
  openAnchorId: Ref<string | null>
}

/** The value `AnchorInsert.addStorage` (`extensions.ts`) installs for every anchor-mode editor. */
export function createAnchorInsertStorage(): AnchorInsertStorage {
  return { openAnchorId: ref<string | null>(null) }
}

function anchorInsertStorage(editor: Editor): AnchorInsertStorage {
  return (editor.storage as unknown as Record<string, AnchorInsertStorage>)[ANCHOR_INSERT_NODE]
}

/**
 * Marks a range as an anchor and returns its new id, or null when there is nothing to mark.
 *
 * `range` defaults to the current selection, which is what lets one command serve both entry
 * points: `AnchorMenu`'s buttons read the live selection, while the `Mod-Alt-h` / `Mod-Alt-s`
 * keyboard shortcuts (`extensions.ts`) call this with no range at all.
 *
 * A wording box opens immediately after the mark, empty and focused, in the **same** transaction —
 * one undo removes both, and there is no hidden "type to discover it" step between marking a
 * passage and seeing somewhere to write about it. `inclusive: false` on the mark (`extensions.ts`)
 * is what keeps that box's position outside the anchor's own range, so accepting it empty and later
 * widening the highlight can never absorb it.
 */
export function addAnchorMark(
  editor: Editor,
  kind: AnchorKind,
  range?: { from: number; to: number },
): string | null {
  const { state } = editor
  const { from, to } = range ?? state.selection
  const markType = state.schema.marks[ANCHOR_MARK]
  const insertType = state.schema.nodes[ANCHOR_INSERT_NODE]
  if (from === to || !markType || !insertType) return null

  const anchorId = newAnchorId()
  const quote = state.doc.textBetween(from, to, ' ')
  const insertNode = insertType.create({ anchorId, text: '' })

  const transaction = state.tr.addMark(from, to, markType.create({ anchorId, kind }))
  transaction.insert(to, insertNode)
  transaction.setSelection(TextSelection.create(transaction.doc, to + insertNode.nodeSize))
  transaction.setMeta(ANCHOR_ANNOUNCE_META, {
    message: `${kind === 'strike' ? 'Struck' : 'Highlighted'} "${quote}"`,
  } satisfies AnchorAnnouncement)

  anchorInsertStorage(editor).openAnchorId.value = anchorId
  dispatchAnchorEdit(editor, transaction)
  return anchorId
}

/**
 * Opens a fresh wording session at `pos`: places an `anchorInsert` node carrying `text` as its
 * first character and marks it the open one, so its node view (`AnchorInsertView.vue`) mounts an
 * input and focuses it. Called from `DocumentEditor`'s `handleTextInput` hook, on the first
 * character typed at an empty selection with nothing marked to pair it with — a bare insertion
 * standing alone. A mark's own wording box opens eagerly instead, from `addAnchorMark` above,
 * rather than waiting on this.
 *
 * `pairWith` is the anchor id this wording pairs with — a mark placed earlier this session whose
 * own box was left empty and closed, per `pairableAnchorAt` — or undefined for a bare insertion
 * with no span of its own.
 */
export function openAnchorInsert(
  editor: Editor,
  pos: number,
  text: string,
  pairWith?: string,
): string | null {
  const nodeType = editor.state.schema.nodes[ANCHOR_INSERT_NODE]
  if (!nodeType) return null

  const anchorId = pairWith ?? newAnchorId()
  const transaction = editor.state.tr.insert(pos, nodeType.create({ anchorId, text }))

  anchorInsertStorage(editor).openAnchorId.value = anchorId
  dispatchAnchorEdit(editor, transaction)
  return anchorId
}

/**
 * Updates the text an open `anchorInsert` node carries, called on every keystroke in its input.
 * Still meta-stamped so the anchor-mode guard lets it through, but otherwise an ordinary attribute
 * change — the node stays an atom the surrounding document can never be typed into directly.
 */
export function updateAnchorInsertText(editor: Editor, pos: number, text: string): void {
  dispatchAnchorEdit(editor, editor.state.tr.setNodeAttribute(pos, 'text', text))
}

/**
 * Commits an open wording session: keeps the node with its trimmed text, or drops it outright if
 * nothing was typed — an insert with no wording says nothing.
 */
export function commitAnchorInsert(editor: Editor, pos: number, text: string): void {
  anchorInsertStorage(editor).openAnchorId.value = null
  const trimmed = text.trim()

  const transaction = trimmed
    ? editor.state.tr.setNodeAttribute(pos, 'text', trimmed)
    : editor.state.tr.delete(pos, pos + 1)

  if (trimmed) {
    transaction.setMeta(ANCHOR_ANNOUNCE_META, {
      message: `Added wording "${trimmed}"`,
    } satisfies AnchorAnnouncement)
  }

  dispatchAnchorEdit(editor, transaction)
}

/** Discards an open wording session outright, whatever was typed — Escape. */
export function cancelAnchorInsert(editor: Editor, pos: number): void {
  anchorInsertStorage(editor).openAnchorId.value = null
  dispatchAnchorEdit(editor, editor.state.tr.delete(pos, pos + 1))
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
