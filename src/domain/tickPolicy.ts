import type { TickReason } from '@/types/entry'

/**
 * When a moment in a writing session is worth bookmarking.
 *
 * Ticks are not saves. Every step is persisted regardless (see the draft buffer); a tick only marks
 * a place worth stopping at when someone later scrubs back through how a piece was written.
 * Confusing the two would either lose work or fill the chain with bookmarks nobody wants.
 *
 * Pure and tunable on purpose: the thresholds are the product decision, and they are the part most
 * likely to be wrong at first, so they are data rather than constants buried in an editor callback.
 */
export interface TickPolicy {
  /** A gap this long before a change means the writer stopped and came back. */
  pauseMs: number
  /** No matter how steadily someone types, bookmark at least this often. */
  intervalMs: number
  /** Text whose last character ends a sentence. */
  sentenceEnd: RegExp
}

export const DEFAULT_TICK_POLICY: TickPolicy = {
  pauseMs: 2_500,
  intervalMs: 60_000,
  sentenceEnd: /[.!?]$/,
}

/** One editor change, reduced to only what the policy needs to judge it. */
export interface TickEvent {
  at: number
  /** Text this change added. Empty for a deletion or a pure formatting change. */
  insertedText: string
  /** True when the change applied a mark or changed a node type rather than text. */
  isFormatting: boolean
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

  if (policy.sentenceEnd.test(event.insertedText)) {
    return 'punctuation'
  }

  if (event.isFormatting) {
    return 'format'
  }

  if (state.lastTickAt !== null && event.at - state.lastTickAt >= policy.intervalMs) {
    return 'interval'
  }

  return null
}
