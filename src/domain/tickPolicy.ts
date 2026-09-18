import type { TickReason } from '@/types/entry'

/**
 * When a moment in a writing session is worth bookmarking. See PRODUCT.md §4.9 for reasoning.
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
}

export const DEFAULT_TICK_POLICY: TickPolicy = {
  pauseMs: 30_000,
  intervalMs: 60_000,
  triggerPatterns: [/[.!?]$/],
}

/** One editor change, reduced to only what the policy needs to judge it. */
export interface TickEvent {
  at: number
  insertedText: string // Text this change added. Empty for a deletion or a pure formatting change.
  isFormatting: boolean // True when the change applied a mark or changed a node type rather than text.
  // True for a structural anchor op (placing, switching, or removing one) — not for typing inside
  // an anchor's wording box. See PRODUCT.md §4.4 and `ANCHOR_TICK_META` in `editor/anchorCommands.ts`.
  isAnchorOp: boolean
}

/** What the session has seen so far. Held by the caller so the policy itself stays stateless. */
export interface TickState {
  lastEventAt: number | null
  lastTickAt: number | null
}

/**
 * The reason to bookmark this moment, or null to let it pass.
 *
 * The order is a priority, not a sequence of independent checks: a long silence is the most
 * meaningful boundary in a session, so it wins over the sentence that broke it.
 */
export function evaluateTick(
  event: TickEvent,
  state: TickState,
  policy: TickPolicy = DEFAULT_TICK_POLICY,
): TickReason | null {
  if (state.lastEventAt !== null && event.at - state.lastEventAt >= policy.pauseMs) {
    return 'pause'
  }

  if (policy.triggerPatterns.some((pattern) => pattern.test(event.insertedText))) {
    return 'punctuation'
  }

  if (event.isAnchorOp) {
    return 'anchor'
  }

  if (event.isFormatting) {
    return 'format'
  }

  if (state.lastTickAt !== null && event.at - state.lastTickAt >= policy.intervalMs) {
    return 'interval'
  }

  return null
}
