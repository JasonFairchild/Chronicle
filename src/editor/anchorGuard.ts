import { isHistoryTransaction } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceStep, type Step } from '@tiptap/pm/transform'

import { ANCHOR_WORDING_MARK } from '@/domain/entryDocument'

import { ANCHOR_EDIT_META } from './anchorCommands'
import { anchorIndex } from './anchorIndex'

// The guard on every editor's document (ENTRY_MODEL.md, "Two creation experiences"): a related
// entry never changes its parent's words, and a sealed anchor never changes at all. Pure, so a bare
// `EditorState` proves it.
//
// It judges outcomes, not steps: each sealed anchor, found by id, must look exactly as it did when
// the editor opened. Predicting that from a step's positions means settling which steps have a
// range, whether an edge is inside, and how an anchor's pieces join, and still guessing wrong where
// a step does nothing. Only anchor mode's typing rule reads steps, since the guard runs before the
// marker: freshly typed text isn't wording yet, so the outcome can't tell it from the parent's.

/** Each sealed anchor by id, as its text, its marks, and the blocks around it. */
export type SealedAnchors = ReadonlyMap<string, Slice>

/**
 * Every anchor in `doc`, as the editor must keep it. A revision seals the document it opens with;
 * anchor mode seals its base, so the session's own anchors are the ones not in here.
 *
 * An anchor runs from its first piece to its last (`anchorIndex`), so a passage and its wording are
 * one stretch, and typing between them changes it. `slice(…, true)` keeps the blocks around the
 * stretch, so a heading or list over its paragraph changes it too.
 */
export function sealAnchors(doc: ProseMirrorNode): SealedAnchors {
  return new Map(
    [...anchorIndex(doc).values()].map((anchor) => [
      anchor.anchorId,
      doc.slice(anchor.from, anchor.to, true),
    ]),
  )
}

/**
 * Whether every sealed anchor is in `doc` as it was. Text typed against an anchor's outer edge
 * carries none of its marks, which aren't inclusive, so it lands outside the stretch.
 */
function keepsSealed(doc: ProseMirrorNode, sealed: SealedAnchors): boolean {
  if (sealed.size === 0) return true

  const anchors = anchorIndex(doc)
  return [...sealed].every(([anchorId, was]) => {
    const anchor = anchors.get(anchorId)
    return anchor !== undefined && doc.slice(anchor.from, anchor.to, true).eq(was)
  })
}

/**
 * Whether `slice` is text alone. A slice across a paragraph break holds paragraphs, so this also
 * rules out a split, a hard break and an image.
 */
function isBareText(slice: Slice): boolean {
  return slice.content.content.every((node) => node.isText)
}

function isWording(node: ProseMirrorNode): boolean {
  return node.marks.some((mark) => mark.type.name === ANCHOR_WORDING_MARK)
}

/**
 * Anchor mode's one edit: insert text, deleting only wording. Sealed wording is already kept by the
 * lock, so what's left is the session's own. Text inserted anywhere else is a bare insertion, which
 * the marker gives a fresh anchor.
 */
function isTyping(step: Step, before: ProseMirrorNode): boolean {
  if (!(step instanceof ReplaceStep) || !isBareText(step.slice)) return false

  const deleted = before.slice(step.from, step.to)
  return isBareText(deleted) && deleted.content.content.every(isWording)
}

/**
 * Whether an editor may apply `transaction`, installed as its `filterTransaction`. Nothing changes a
 * sealed anchor; past that, anchor commands and undo skip the typing rule, since the commands mark
 * and unmark passages and undo returns to a document the guard already allowed.
 */
export function allowsEdit(
  transaction: Transaction,
  sealed: SealedAnchors,
  anchorMode: boolean,
): boolean {
  // A selection change also passes through here, and has nothing to judge.
  if (!transaction.docChanged) return true
  if (!keepsSealed(transaction.doc, sealed)) return false
  if (transaction.getMeta(ANCHOR_EDIT_META) === true || isHistoryTransaction(transaction)) {
    return true
  }
  return !anchorMode || transaction.steps.every((step, i) => isTyping(step, transaction.docs[i]!))
}
