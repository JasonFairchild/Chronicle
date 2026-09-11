import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
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
 * The anchor-mode guard, installed by `extensions.ts`'s `AnchorModeGuard` plugin.
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
