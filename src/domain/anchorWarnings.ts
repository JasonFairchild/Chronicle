/**
 * Which edits disturb an anchor.
 *
 * The rule is deliberately narrow: warn when the text **under** an anchor changes — something
 * inserted inside it, or part or all of it deleted or replaced — and stay silent when the anchor
 * merely shifts because of an edit somewhere else. A note about the third paragraph is still about
 * the third paragraph after you fix a typo in the first, and warning about that would train the
 * warning away.
 *
 * The measurement is ProseMirror's own step maps, not a text comparison: each range a step replaced
 * is checked against the span as it stood just before that step. This module holds only the
 * decision, so it stays pure and node-testable; the editor layer walks the maps to feed it.
 */

/** A stretch of document positions: an anchor's span, or the range one step replaced. */
export interface PositionRange {
  from: number
  to: number
}

/**
 * Whether replacing `change` altered the text under `span`, both measured before that step.
 *
 * An insertion (an empty `change`) counts only strictly inside: text typed at either edge lands
 * outside the span, matching the mark's `inclusive: false`. A removal counts once it overlaps the
 * span at all — a same-length replacement included, which no comparison of lengths would see.
 */
export function changesInside(span: PositionRange, change: PositionRange): boolean {
  if (change.from === change.to) return span.from < change.from && change.from < span.to
  return change.from < span.to && change.to > span.from
}
