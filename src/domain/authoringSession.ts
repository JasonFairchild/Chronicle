import type { AuthoringStep, AuthoringTick, AuthoringTrace, TickReason } from '@/types/entry'
import { DEFAULT_TICK_POLICY, evaluateTick, type TickPolicy, type TickState } from './tickPolicy'

export interface AuthoringSessionOptions {
  sessionId: string
  startedAt?: string
  policy?: TickPolicy
  /** Injected so tests can drive time instead of waiting for it. */
  now?: () => number
}

/** One editor change, as the session needs to see it. */
export interface AuthoringChange {
  /** Serialized ProseMirror steps, already JSON. The session never interprets them. */
  steps: unknown[]
  /** Text this change added, used only to spot a finished sentence. */
  insertedText?: string
  isFormatting?: boolean
  /** A structural anchor op — see `TickEvent.isAnchorOp` (`tickPolicy.ts`). */
  isAnchorOp?: boolean
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

  private readonly policy: TickPolicy
  private readonly now: () => number
  private readonly recordedSteps: AuthoringStep[] = []
  private readonly recordedTicks: AuthoringTick[] = []
  private state: TickState

  constructor(options: AuthoringSessionOptions) {
    this.sessionId = options.sessionId
    this.now = options.now ?? (() => Date.now())
    this.startedAt = options.startedAt ?? new Date(this.now()).toISOString()
    this.policy = options.policy ?? DEFAULT_TICK_POLICY
    // Seeded from the start so the interval rule has a baseline to measure from; without it a
    // session that never pauses or punctuates would never be bookmarked at all.
    this.state = { lastEventAt: null, lastTickAt: this.now() }
  }

  get steps(): AuthoringStep[] {
    return [...this.recordedSteps]
  }

  get ticks(): AuthoringTick[] {
    return [...this.recordedTicks]
  }

  /** Appends a change's steps, then asks the policy whether this moment deserves a bookmark. */
  record(change: AuthoringChange): void {
    const at = this.now()
    const iso = new Date(at).toISOString()

    for (const step of change.steps) {
      this.recordedSteps.push({ at: iso, step })
    }

    const reason = evaluateTick(
      {
        at,
        insertedText: change.insertedText ?? '',
        isFormatting: change.isFormatting ?? false,
        isAnchorOp: change.isAnchorOp ?? false,
      },
      this.state,
      this.policy,
    )

    this.state = { ...this.state, lastEventAt: at }
    if (reason) this.mark(reason)
  }

  /** Bookmarks the current end of the chain. `manual` is the user asking for one. */
  mark(reason: TickReason = 'manual'): void {
    const at = this.now()

    this.recordedTicks.push({
      at: new Date(at).toISOString(),
      step_index: this.recordedSteps.length,
      reason,
    })
    this.state = { ...this.state, lastTickAt: at }
  }

  /** Restores a session interrupted by a reload, so a resumed draft keeps its history. */
  static resume(
    options: AuthoringSessionOptions & { steps: AuthoringStep[]; ticks: AuthoringTick[] },
  ): AuthoringSession {
    const session = new AuthoringSession(options)
    session.recordedSteps.push(...options.steps)
    session.recordedTicks.push(...options.ticks)
    return session
  }

  /**
   * The finished trace, or null when nothing was captured. Null means "typing was not recorded" —
   * an import, a seed, a fixture — and never "this entry has no content".
   */
  seal(): AuthoringTrace | null {
    if (this.recordedSteps.length === 0) return null

    return {
      session_id: this.sessionId,
      started_at: this.startedAt,
      ended_at: new Date(this.now()).toISOString(),
      steps: this.steps,
      ticks: this.ticks,
    }
  }
}
