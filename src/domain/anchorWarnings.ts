/**
 * Which anchors an edit actually disturbed.
 *
 * The rule is deliberately narrow: warn when the text **under** an anchor changes — something
 * inserted inside it, or part or all of it deleted — and stay silent when the anchor merely shifts
 * because of an edit somewhere else. A note about the third paragraph is still about the third
 * paragraph after you fix a typo in the first, and warning about that would train the warning away.
 *
 * The measurement is ProseMirror's own step mapping, not a text comparison: the endpoints are
 * mapped through the pending session's `Mapping` and the deletion flags are read off the results.
 * This module holds only the decision, so it stays pure and node-testable; the editor layer is
 * where the `Mapping` is walked to produce these.
 */

import type { AnchorRef } from '@/types/entry'

export interface AnchorMapping extends AnchorRef {
  /** Positions the anchor spanned before the edit. */
  length: number
  /** Positions it spans once both endpoints are mapped through the edit. */
  mappedLength: number
  /**
   * Whether ProseMirror reported content removed from inside the span — `deletedAfter` on the
   * start, or `deletedBefore` on the end. Length alone would miss a same-size replacement.
   */
  deletedInside: boolean
}

/**
 * The anchors whose covered text changed, in the order given.
 *
 * Length is the signal for insertion and deletion at once: the endpoints are mapped with the same
 * bias the mark's `inclusive: false` gives it, so text typed at either edge lands outside the span
 * and leaves the length alone, while text typed inside it lengthens the span and a deletion
 * shortens it.
 */
export function anchorsAffectedBy(mappings: AnchorMapping[]): AnchorMapping[] {
  return mappings.filter(
    (mapping) => mapping.deletedInside || mapping.mappedLength !== mapping.length,
  )
}
