import type { AuthoringStep, AuthoringTick, AuthoringTrace, TickReason } from '@/types/entry'
import {
  DEFAULT_TICK_POLICY,
  evaluateTick,
  sortByPriority,
  type ChangeSignals,
  type TickPolicy,
  type TickState,
} from './tickPolicy'

export interface AuthoringSessionOptions {
  sessionId: string
  startedAt?: string
  policy?: TickPolicy
  /** Injected so tests can drive time instead of waiting for it. */
  now?: () => number
}

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

  private readonly policy: TickPolicy
  private readonly now: () => number
  private lastReadAt: number // The floor `readClock` enforces: the latest instant already used.
  private readonly recordedSteps: AuthoringStep[] = []
  private readonly recordedTicks: AuthoringTick[] = []
  private state: TickState
  private inDeletionRun = false // Whether the last change removed text and its run is still open.

  constructor(options: AuthoringSessionOptions) {
    this.sessionId = options.sessionId
    this.now = options.now ?? (() => Date.now())
    this.startedAt = options.startedAt ?? new Date(this.now()).toISOString()
    this.startedAtMs = Date.parse(this.startedAt)
    if (Number.isNaN(this.startedAtMs)) {
      throw new Error(`AuthoringSession: "${this.startedAt}" is not a parseable timestamp`)
    }
    this.policy = options.policy ?? DEFAULT_TICK_POLICY
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
      this.state.lastEventAt !== null && at - this.state.lastEventAt >= this.policy.pauseMs

    if (this.inDeletionRun && (!removesText || pausedSinceLastEvent)) this.closeDeletionRun()
    this.inDeletionRun = removesText

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
      this.policy,
    )

    this.state = { ...this.state, lastEventAt: at }
    // One tick per change no matter how many rules agree, never one per rule — `mark` requires a
    // non-empty tuple, which is what forces this destructure-and-check instead of passing the
    // array straight through. `at` is threaded through rather than read again inside `mark`, so
    // the step this tick bookmarks and the tick itself share one clock read.
    if (reason) this.mark([reason, ...rest], at)
  }

  /**
   * Bookmarks the current end of the chain. `manual` is the user asking for one — the only caller
   * that doesn't already have an `at` from a `record()` in progress, hence the default read here.
   *
   * A tick landing within `policy.minTickGapMs` of the previous one merges into it rather than
   * adding a second right beside it — what keeps bolding eight words one at a time from becoming
   * eight stops on a scrub bar. The merged tick's `at`/`step_index` move up to this event's, so it
   * sits at the end of the cluster it now represents; reasons union and re-sort, since the merge can
   * bring in a reason the earlier tick didn't have.
   */
  mark(reasons: [TickReason, ...TickReason[]] = ['manual'], at: number = this.readClock()): void {
    const last = this.recordedTicks[this.recordedTicks.length - 1]
    const gapSinceLastTick = this.state.lastTickAt === null ? Infinity : at - this.state.lastTickAt

    if (last && gapSinceLastTick < this.policy.minTickGapMs) {
      last.at = at - this.startedAtMs
      last.step_index = this.recordedSteps.length
      // Non-empty: a union that includes `reasons`, which is.
      last.reasons = sortByPriority([...last.reasons, ...reasons]) as [TickReason, ...TickReason[]]
    } else {
      this.recordedTicks.push({
        at: at - this.startedAtMs,
        step_index: this.recordedSteps.length,
        reasons,
      })
    }

    // `max` because a `deletion` tick is stamped back at its run's last step, which a manual
    // bookmark taken since may already be later than.
    this.state = { ...this.state, lastTickAt: Math.max(at, this.state.lastTickAt ?? at) }
  }

  /** Bookmarks the end of the open deletion run, at the last deleting step. */
  private closeDeletionRun(): void {
    this.inDeletionRun = false
    this.mark(['deletion'], this.state.lastEventAt ?? this.readClock())
  }

  /**
   * Restores a session interrupted by a reload, so a resumed draft keeps its history. Seeds
   * `lastEventAt` from the last step it was given, converting that step's relative offset back to
   * an absolute instant via this session's own `startedAtMs` — so the first keystroke after a
   * genuine gap fires `pause` the same way it would have without the reload, and one picked back up
   * within a moment fires nothing. Left `null` when there are no steps (the normal case for
   * `parentSession` on a non-anchor draft), same as a fresh session. `lastTickAt` is deliberately
   * left alone: the constructor already seeds it from `now()`, and seeding it from the last tick
   * instead would make that same keystroke fire `interval` too.
   *
   * Restored offsets also raise `readClock`'s floor, so the clock having moved backwards across the
   * reload cannot stamp a new step before one the previous run already recorded. Ticks count toward
   * that floor as well as steps: a manual bookmark can be the latest thing the old run stamped.
   */
  static resume(
    options: AuthoringSessionOptions & { steps: AuthoringStep[]; ticks: AuthoringTick[] },
  ): AuthoringSession {
    const session = new AuthoringSession(options)
    session.recordedSteps.push(...options.steps)
    session.recordedTicks.push(...options.ticks)

    const lastStep = options.steps[options.steps.length - 1]
    if (lastStep) {
      session.state = { ...session.state, lastEventAt: session.startedAtMs + lastStep.at }
    }

    const lastTick = options.ticks[options.ticks.length - 1]
    const restoredEnd = Math.max(lastStep?.at ?? 0, lastTick?.at ?? 0)
    session.lastReadAt = Math.max(session.lastReadAt, session.startedAtMs + restoredEnd)

    return session
  }

  /**
   * The finished trace, or null when nothing was captured. Null means "typing was not recorded" —
   * an import, a seed, a fixture — and never "this entry has no content". Closes a deletion run
   * still open, since nothing after it will.
   */
  seal(): AuthoringTrace | null {
    if (this.recordedSteps.length === 0) return null
    if (this.inDeletionRun) this.closeDeletionRun()

    return {
      session_id: this.sessionId,
      started_at: this.startedAt,
      ended_at: new Date(this.readClock()).toISOString(),
      steps: this.steps,
      ticks: this.ticks,
    }
  }
}
