import type { AuthoringEvent, AuthoringTrace, ChangeSignals, EditEvent } from '@/types/entry'

/** One editor change, as the recorder needs it. A signal left out reads as unset. */
export interface AuthoringChange extends Partial<ChangeSignals> {
  steps: unknown[] // Serialized ProseMirror steps, already JSON. Never interpreted here.
}

/**
 * Records one writing session as an append-only event log: every edit with its signals, and every
 * mark the writer asks for. Which moments are worth stopping at is not decided here; `deriveMarks`
 * reads that off the log under whichever policy is asked for.
 *
 * Holds the document it started from but never the live one: the snapshot is the draft's job, and
 * keeping the two apart is what lets the snapshot stay authoritative if a schema change ever makes
 * old steps unreplayable. The loss then is scrubbing, never words.
 */
export class AuthoringSession {
  readonly sessionId: string
  readonly startedAt: string
  readonly baseContent: string
  private readonly startedAtMs: number // Parsed once, so every offset measures from one instant.
  private readonly now: () => number
  private lastReadAt: number // The floor `readClock` enforces: the latest instant already used.
  private readonly recorded: AuthoringEvent[] = []

  /** `now` is injected so tests can drive time instead of waiting for it. */
  constructor(
    sessionId: string,
    startedAt: string,
    baseContent: string,
    now: () => number = () => Date.now(),
  ) {
    this.sessionId = sessionId
    this.startedAt = startedAt
    this.baseContent = baseContent
    this.now = now
    this.startedAtMs = Date.parse(startedAt)
    if (Number.isNaN(this.startedAtMs)) {
      throw new Error(`AuthoringSession: "${startedAt}" is not a parseable timestamp`)
    }
    this.lastReadAt = this.startedAtMs
  }

  /**
   * The clock, floored at the latest instant this session has already used. `Date.now` can step
   * backwards (an NTP correction, a resume from sleep); flooring keeps each event's `at` from
   * landing before its predecessor's. The cost is that one gap reads as ~0 when the clock really
   * does move back, which is the honest answer to a clock that lied.
   */
  private readClock(): number {
    this.lastReadAt = Math.max(this.now(), this.lastReadAt)
    return this.lastReadAt
  }

  get events(): AuthoringEvent[] {
    return [...this.recorded]
  }

  /** Appends an edit, storing only the signals that are set. */
  record(change: AuthoringChange): void {
    const edit: EditEvent = {
      kind: 'edit',
      at: this.readClock() - this.startedAtMs,
      steps: change.steps,
    }
    if (change.inserted_text) edit.inserted_text = change.inserted_text
    if (change.removed_chars) edit.removed_chars = change.removed_chars
    if (change.is_formatting) edit.is_formatting = true
    if (change.is_anchor_op) edit.is_anchor_op = true
    if (change.is_paste) edit.is_paste = true
    if (change.media_changed) edit.media_changed = true

    this.recorded.push(edit)
  }

  /** A mark the writer asked for, at the current end of the log. */
  mark(): void {
    this.recorded.push({ kind: 'manual', at: this.readClock() - this.startedAtMs })
  }

  /**
   * Restores a session interrupted by a reload: the log carries on where it stopped, and the clock
   * floor rises to its last event, so a clock that came back behind the previous run can't stamp
   * an event before one already recorded.
   */
  static resume(
    sessionId: string,
    startedAt: string,
    baseContent: string,
    events: AuthoringEvent[],
    now?: () => number,
  ): AuthoringSession {
    const session = new AuthoringSession(sessionId, startedAt, baseContent, now)
    session.recorded.push(...events)
    session.lastReadAt += events[events.length - 1]?.at ?? 0
    return session
  }

  /**
   * The finished trace, or null when nothing was typed — manual marks alone don't count. Null means
   * "typing was not recorded" (an import, a seed, a fixture), never "this entry has no content".
   */
  seal(): AuthoringTrace | null {
    if (!this.recorded.some((event) => event.kind === 'edit')) return null

    return {
      session_id: this.sessionId,
      started_at: this.startedAt,
      ended_at: new Date(this.readClock()).toISOString(),
      base_content: this.baseContent,
      events: this.events,
    }
  }
}
