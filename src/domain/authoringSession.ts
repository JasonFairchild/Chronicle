import type { AuthoringStep, AuthoringTick, AuthoringTrace, TickReason } from '@/types/entry'
import {
  DEFAULT_TICK_POLICY,
  evaluateTick,
  sortByPriority,
  type ChangeSignals,
  type TickState,
} from './tickPolicy'

/**
 * One editor change, as the session needs to see it. `ChangeSignals` are optional here — a caller
 * focused on the steps alone, most tests among them, has nothing to say about them, and `record`
 * is the one place their defaults are filled.
 */
export interface AuthoringChange extends Partial<ChangeSignals> {
  /** Serialized ProseMirror steps, already JSON. The session never interprets them. */
  steps: unknown[]
  /**
   * Characters this change removed. Only whether it is above zero matters: that is what makes it
   * part of a deletion run (see `record`). Not part of `ChangeSignals`, since the policy never
   * judges it. Absent or zero means this change removed nothing.
   */
  removedChars?: number
}

/**
 * Accumulates one writing session: every step in order, plus bookmarks at the moments worth
 * returning to.
 *
 * Steps are the unit rather than repeated document snapshots because a step is tiny, invertible,
 * and composes into a mapping that can move an anchor from an old document into a new one exactly.
 * That mapping is the reason anchors survive edits instead of being re-guessed by text search.
 *
 * Deliberately holds no content: the document snapshot is the draft's job, and keeping the two
 * apart is what lets the snapshot stay authoritative if a schema change ever makes old steps
 * unreplayable. The loss then is scrubbing, never words.
 */
export class AuthoringSession {
  readonly sessionId: string
  readonly startedAt: string
  /** `startedAt` parsed once, so every step/tick offset measures from the same instant. */
  private readonly startedAtMs: number
  private readonly now: () => number
  private lastReadAt: number // The floor `readClock` enforces: the latest instant already used.
  private readonly recordedSteps: AuthoringStep[] = []
  private readonly recordedTicks: AuthoringTick[] = []
  private state: TickState
  private deletionRunLastAt: number | null = null // The open run's latest deleting instant, if any.

  /** `now` is injected so tests can drive time instead of waiting for it. */
  constructor(sessionId: string, startedAt: string, now: () => number = () => Date.now()) {
    this.sessionId = sessionId
    this.now = now
    this.startedAt = startedAt
    this.startedAtMs = Date.parse(this.startedAt)
    if (Number.isNaN(this.startedAtMs)) {
      throw new Error(`AuthoringSession: "${this.startedAt}" is not a parseable timestamp`)
    }
    this.lastReadAt = this.startedAtMs
    // Seeded from the start so the interval rule has a baseline to measure from; without it a
    // session that never pauses or punctuates would never be bookmarked at all.
    this.state = { lastEventAt: null, lastTickAt: this.readClock() }
  }

  /**
   * The clock, floored at the latest instant this session has already used. `now` is `Date.now` by
   * default, which NTP corrections and sleep/resume reconciliation can step backwards; a step
   * stamped from a read that came back low would sit before its predecessor, inverting `at` against
   * `step_index` — the very thing ENTRY_MODEL.md tells a scrub UI not to trust `at` for. Flooring
   * makes that impossible by construction.
   *
   * The cost is that one event's gap reads as ~0 when the clock genuinely moves back, which can
   * make a `pause` tick under-fire right at that seam. Its true value is unknowable — the clock
   * lied — so ~0 is the honest answer, and it is local to the one event.
   *
   * An `at` the session computes for itself, such as the deletion run's deliberate backdating in
   * `closeDeletionRun`, is passed explicitly and so is never clamped: only reads are suspect.
   */
  private readClock(): number {
    this.lastReadAt = Math.max(this.now(), this.lastReadAt)
    return this.lastReadAt
  }

  get steps(): AuthoringStep[] {
    return [...this.recordedSteps]
  }

  get ticks(): AuthoringTick[] {
    return [...this.recordedTicks]
  }

  /**
   * Appends a change's steps, then asks the policy whether this moment deserves a bookmark.
   *
   * A deletion of any size is bookmarked, but only once its run has ended — the first change that
   * removes nothing, or the first deletion after a pause, closes it (`closeDeletionRun`), so the
   * bookmark sits at the last deleting step and covers everything removed in one go. That happens
   * before this change's steps are appended, which is what keeps the bookmark off the change that
   * ended the run.
   *
   * The state update order is load-bearing: evaluate before setting `lastEventAt`, which must not
   * happen before `evaluateTick` sees the *previous* value (the pause check measures the gap since
   * the last event, not since this one).
   */
  record(change: AuthoringChange): void {
    const at = this.readClock()
    const removesText = (change.removedChars ?? 0) > 0
    const pausedSinceLastEvent =
      this.state.lastEventAt !== null && at - this.state.lastEventAt >= DEFAULT_TICK_POLICY.pauseMs

    if (!removesText || pausedSinceLastEvent) this.closeDeletionRun()
    if (removesText) this.deletionRunLastAt = at

    for (const step of change.steps) {
      this.recordedSteps.push({ at: at - this.startedAtMs, step })
    }

    const [reason, ...rest] = evaluateTick(
      {
        at,
        insertedText: '',
        isFormatting: false,
        isAnchorOp: false,
        isPaste: false,
        mediaChanged: false,
        ...change,
      },
      this.state,
    )

    this.state = { ...this.state, lastEventAt: at }
    // One tick per change no matter how many rules agree, never one per rule — `addTick` requires
    // a non-empty tuple, which is what forces this destructure-and-check instead of passing the
    // array straight through. `at` is threaded through rather than read again, so the step this
    // tick bookmarks and the tick itself share one clock read.
    if (reason) this.addTick([reason, ...rest], at)
  }

  /**
   * A bookmark the writer asked for, at the current end of the chain. It ends any open deletion run
   * first: that run's tick is backdated to its last deleting change, and closing it here is what
   * keeps it from ever landing behind this one.
   */
  manualMark(): void {
    this.closeDeletionRun()
    this.addTick(['manual'], this.readClock())
  }

  /**
   * Bookmarks the current end of the chain at `at`, which callers guarantee is no earlier than any
   * tick before it.
   *
   * A tick landing within `minTickGapMs` of the last recorded tick merges into it rather than adding
   * a second right beside it — what keeps bolding eight words one at a time from becoming eight
   * stops on a scrub bar. The merged tick's `at`/`step_index` move up to this event's, so it sits at
   * the end of the cluster it now represents; reasons union and re-sort, since the merge can bring
   * in a reason the earlier tick didn't have. A manual bookmark never merges, in either direction:
   * the writer placed it deliberately, so nothing moves it or folds it into another tick.
   *
   * The window measures from the last tick itself, not `state.lastTickAt`: after `resume` those
   * differ, and measuring from the seed would fold a bookmark taken before the reload into one
   * taken after it.
   */
  private addTick(reasons: [TickReason, ...TickReason[]], at: number): void {
    const last = this.recordedTicks[this.recordedTicks.length - 1]
    const offset = at - this.startedAtMs
    const merges =
      last !== undefined &&
      offset - last.at < DEFAULT_TICK_POLICY.minTickGapMs &&
      !last.reasons.includes('manual') &&
      !reasons.includes('manual')

    if (merges) {
      last.at = offset
      last.step_index = this.recordedSteps.length
      // Non-empty: a union that includes `reasons`, which is.
      last.reasons = sortByPriority([...last.reasons, ...reasons]) as [TickReason, ...TickReason[]]
    } else {
      this.recordedTicks.push({ at: offset, step_index: this.recordedSteps.length, reasons })
    }

    this.state = { ...this.state, lastTickAt: at }
  }

  /** Bookmarks the end of the open deletion run, if there is one, at its last deleting change. */
  private closeDeletionRun(): void {
    if (this.deletionRunLastAt === null) return

    const at = this.deletionRunLastAt
    this.deletionRunLastAt = null
    this.addTick(['deletion'], at)
  }

  /**
   * Restores a session interrupted by a reload, so a resumed draft keeps its history. Seeds
   * `lastEventAt` from the last step it was given, converting that step's relative offset back to
   * an absolute instant via this session's own `startedAtMs` — so the first keystroke after a
   * genuine gap fires `pause` the same way it would have without the reload, and one picked back up
   * within a moment fires nothing. Left `null` when there are no steps (the normal case for
   * `parentSession` on a non-anchor draft), same as a fresh session.
   *
   * Restored offsets also raise `readClock`'s floor, so the clock having moved backwards across the
   * reload cannot stamp a new step before one the previous run already recorded. Ticks count toward
   * that floor as well as steps: a manual bookmark can be the latest thing the old run stamped.
   *
   * `lastTickAt` restarts at that raised floor rather than at the last restored tick, which would
   * make the first keystroke after a long gap fire `interval` alongside `pause`. It is set after the
   * floor rises, so a clock that came back behind the previous run can't inflate the first gap.
   */
  static resume(
    sessionId: string,
    startedAt: string,
    history: { steps: AuthoringStep[]; ticks: AuthoringTick[] },
    now?: () => number,
  ): AuthoringSession {
    const session = new AuthoringSession(sessionId, startedAt, now)
    session.recordedSteps.push(...history.steps)
    session.recordedTicks.push(...history.ticks)

    const lastStep = history.steps[history.steps.length - 1]
    const lastTick = history.ticks[history.ticks.length - 1]
    const restoredEnd = Math.max(lastStep?.at ?? 0, lastTick?.at ?? 0)
    session.lastReadAt = Math.max(session.lastReadAt, session.startedAtMs + restoredEnd)

    session.state = {
      lastEventAt: lastStep ? session.startedAtMs + lastStep.at : null,
      lastTickAt: session.lastReadAt,
    }

    return session
  }

  /**
   * The finished trace, or null when nothing was captured. Null means "typing was not recorded" —
   * an import, a seed, a fixture — and never "this entry has no content". Closes a deletion run
   * still open, since nothing after it will.
   */
  seal(): AuthoringTrace | null {
    if (this.recordedSteps.length === 0) return null
    this.closeDeletionRun()

    return {
      session_id: this.sessionId,
      started_at: this.startedAt,
      ended_at: new Date(this.readClock()).toISOString(),
      steps: this.steps,
      ticks: this.ticks,
    }
  }
}
