import type { TickReason } from '@/types/entry'

/**
 * When a moment in a writing session is worth bookmarking (ENTRY_MODEL.md, "Authoring capture").
 *
 * Ticks are not saves — every step is persisted regardless, via the draft buffer. Confusing the
 * two would either lose work or fill the chain with bookmarks nobody wants.
 *
 * Pure and tunable on purpose: the thresholds are the product decision, and they are the part most
 * likely to be wrong at first, so they are data rather than constants buried in an editor callback.
 */
export interface TickPolicy {
  pauseMs: number // A gap this long before a change means the writer stopped and came back.
  intervalMs: number // No matter how steadily someone types, bookmark at least this often.
  triggerPatterns: RegExp[] // Inserted text matching any of these ends a bookmarkable unit.
  /**
   * A tick landing this close to the previous one merges into it instead of adding a second —
   * bolding eight words one at a time would otherwise be eight `format` stops on the scrub bar.
   * See `AuthoringSession.mark`.
   */
  minTickGapMs: number
}

export const DEFAULT_TICK_POLICY: TickPolicy = {
  pauseMs: 30_000,
  intervalMs: 60_000,
  triggerPatterns: [/[.!?]$/],
  minTickGapMs: 2_000,
}

/**
 * The bookmark reasons, most worth showing first: what the writer deliberately did (`manual`, then
 * the app's distinctive actions) outranks ordinary editing, which outranks the ambient signals of
 * timing and sentence endings — `pause` describes when, not what, and co-occurs with nearly
 * anything after a break, so it must not mask a paste or a deletion as the displayed label.
 */
export const TICK_REASON_PRIORITY: readonly TickReason[] = [
  'manual',
  'anchor',
  'media',
  'paste',
  'deletion',
  'format',
  'pause',
  'punctuation',
  'interval',
]

/** Orders reasons by `TICK_REASON_PRIORITY` and drops duplicates, so `[0]` is the one worth showing. */
export function sortByPriority(reasons: readonly TickReason[]): TickReason[] {
  return TICK_REASON_PRIORITY.filter((reason) => reasons.includes(reason))
}

/**
 * The facts about one editor change that the tick policy, the authoring session, the draft buffer,
 * and `DocumentEditor`'s own emit all need to agree on — one definition adopted by `extends` at
 * each of those, so a new signal is one field to add rather than one to keep in sync by hand.
 */
export interface ChangeSignals {
  insertedText: string // Text this change added. Empty for a deletion or a pure formatting change.
  isFormatting: boolean // True when the change applied a mark or changed a node type rather than text.
  // True for a structural anchor op (placing, switching, or removing one) — not for typing inside
  // an anchor's wording box. Judged by outcome; see `contentDelta` in `domain/entryDocument.ts`.
  isAnchorOp: boolean
  isPaste: boolean // True when the change arrived via paste — the transaction's own `uiEvent` meta.
  mediaChanged: boolean // True when the change attached or removed media. See `contentDelta`.
}

/** One editor change, reduced to only what the policy needs to judge it. */
export interface TickEvent extends ChangeSignals {
  at: number
}

/** What the session has seen so far. Held by the caller so the policy itself stays stateless. */
export interface TickState {
  lastEventAt: number | null
  lastTickAt: number | null
}

/**
 * Every reason this moment is worth bookmarking, ordered by priority — not a choice between them,
 * since a change can satisfy several at once (a sentence finished right after a long pause is
 * both). The checks below run in no particular order; the result is sorted by
 * `TICK_REASON_PRIORITY` at the end, so the first entry is the one worth showing. Fires iff at
 * least one check passes, empty meaning nothing to bookmark.
 *
 * `deletion` is not among them: a run of deletions is bookmarked when it *ends*, which is a fact
 * about the change after it rather than about this one, so `AuthoringSession` marks it itself.
 */
export function evaluateTick(
  event: TickEvent,
  state: TickState,
  policy: TickPolicy = DEFAULT_TICK_POLICY,
): TickReason[] {
  const reasons: TickReason[] = []

  if (state.lastEventAt !== null && event.at - state.lastEventAt >= policy.pauseMs) {
    reasons.push('pause')
  }

  if (event.isPaste) {
    reasons.push('paste')
  }

  if (event.mediaChanged) {
    reasons.push('media')
  }

  if (policy.triggerPatterns.some((pattern) => pattern.test(event.insertedText))) {
    reasons.push('punctuation')
  }

  if (event.isAnchorOp) {
    reasons.push('anchor')
  }

  if (event.isFormatting) {
    reasons.push('format')
  }

  if (state.lastTickAt !== null && event.at - state.lastTickAt >= policy.intervalMs) {
    reasons.push('interval')
  }

  return sortByPriority(reasons)
}
