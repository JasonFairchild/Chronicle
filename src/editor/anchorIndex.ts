import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'

import { ANCHOR_MARK, ANCHOR_WORDING_MARK } from '@/domain/entryDocument'
import type { AnchorKind } from '@/types/entry'

// Where each anchor is in a document: one reading, shared by the guard, the decorations and the
// commands (ENTRY_MODEL.md, "Related entries and anchors").

/** One text node carrying an anchor's mark. */
export interface AnchorPiece {
  readonly from: number
  readonly to: number
  /** The mark itself, so a command removes that mark, not every one of its type in the range. */
  readonly mark: Mark
}

export interface IndexedAnchor {
  readonly anchorId: string
  /** From the anchor's first piece to its last, so a passage and its wording are one stretch. */
  readonly from: number
  readonly to: number
  /** Null for a bare insertion: wording with no passage. */
  readonly kind: AnchorKind | null
  /** The passage's pieces, in document order. */
  readonly passage: readonly AnchorPiece[]
  /** The wording's pieces, in document order. */
  readonly wording: readonly AnchorPiece[]
}

/** Each anchor by id, in document order of its first piece. Shared, so never mutated. */
export type AnchorIndex = ReadonlyMap<string, IndexedAnchor>

function buildIndex(doc: ProseMirrorNode): AnchorIndex {
  const index = new Map<
    string,
    {
      anchorId: string
      from: number
      to: number
      kind: AnchorKind | null
      passage: AnchorPiece[]
      wording: AnchorPiece[]
    }
  >()

  doc.descendants((node, pos) => {
    if (!node.isText) return true

    for (const mark of node.marks) {
      const isPassage = mark.type.name === ANCHOR_MARK
      if (!isPassage && mark.type.name !== ANCHOR_WORDING_MARK) continue
      const anchorId: unknown = mark.attrs.anchorId
      if (typeof anchorId !== 'string' || !anchorId) continue

      const to = pos + node.nodeSize
      let anchor = index.get(anchorId)
      if (!anchor) {
        anchor = { anchorId, from: pos, to, kind: null, passage: [], wording: [] }
        index.set(anchorId, anchor)
      }
      anchor.to = to // Text nodes come in document order, so the latest piece ends the anchor.
      if (isPassage) {
        anchor.kind ??= mark.attrs.kind as AnchorKind
        anchor.passage.push({ from: pos, to, mark })
      } else {
        anchor.wording.push({ from: pos, to, mark })
      }
    }

    return true
  })

  return index
}

const indexes = new WeakMap<ProseMirrorNode, AnchorIndex>()

/**
 * `doc`'s anchors, walked once per document: ProseMirror documents are immutable, so a caret move,
 * which keeps the document, reuses its index.
 */
export function anchorIndex(doc: ProseMirrorNode): AnchorIndex {
  let index = indexes.get(doc)
  if (!index) {
    index = buildIndex(doc)
    indexes.set(doc, index)
  }
  return index
}
