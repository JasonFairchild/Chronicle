import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICK_POLICY,
  evaluateTick,
  type TickEvent,
  type TickState,
} from '@/domain/tickPolicy'

/** A neutral event: every signal off, so a test sets only the ones it cares about. */
function event(overrides: Partial<TickEvent> & Pick<TickEvent, 'at' | 'insertedText'>): TickEvent {
  return {
    isFormatting: false,
    isAnchorOp: false,
    isPaste: false,
    mediaChanged: false,
    ...overrides,
  }
}

/** A neutral state: no history. */
function state(overrides: Partial<TickState> = {}): TickState {
  return { lastEventAt: null, lastTickAt: null, ...overrides }
}

describe('evaluateTick', () => {
  it('records a finished sentence after a silence as both, rather than only the silence that outranked it', () => {
    const at = DEFAULT_TICK_POLICY.pauseMs + 5_000

    const reasons = evaluateTick(
      event({ at, insertedText: '.' }),
      state({ lastEventAt: 5_000, lastTickAt: 5_000 }),
    )

    expect(reasons).toEqual(['pause', 'punctuation'])
  })

  it('orders the reasons it found by priority, so the first is the one worth showing', () => {
    const reasons = evaluateTick(
      event({ at: 1_100, insertedText: '', isFormatting: true, isAnchorOp: true }),
      state({ lastEventAt: 1_000, lastTickAt: 1_000 }),
    )

    expect(reasons).toEqual(['anchor', 'format'])
  })

  it('bookmarks a finished sentence but not a word still being typed', () => {
    const s = state({ lastEventAt: 1_000, lastTickAt: 1_000 })

    expect(evaluateTick(event({ at: 1_100, insertedText: 'end.' }), s)).toEqual(['punctuation'])
  })

  it('honours a tuned punctuation set, so a semicolon ends a unit only when asked to', () => {
    const s = state({ lastEventAt: 1_000, lastTickAt: 1_000 })
    const semicolons = { ...DEFAULT_TICK_POLICY, punctuation: ';' }

    expect(evaluateTick(event({ at: 1_100, insertedText: 'a;' }), s)).toEqual([])
    expect(evaluateTick(event({ at: 1_100, insertedText: 'a;' }), s, semicolons)).toEqual([
      'punctuation',
    ])
    expect(evaluateTick(event({ at: 1_100, insertedText: 'a.' }), s, semicolons)).toEqual([])
  })

  it('bookmarks text matching a configured pattern as its own reason, not as punctuation', () => {
    const s = state({ lastEventAt: 1_000, lastTickAt: 1_000 })
    const todo = { ...DEFAULT_TICK_POLICY, triggerPatterns: [/TODO/] }

    expect(evaluateTick(event({ at: 1_100, insertedText: 'TODO' }), s)).toEqual([])
    expect(evaluateTick(event({ at: 1_100, insertedText: 'TODO' }), s, todo)).toEqual(['pattern'])
  })

  it('ranks a configured pattern above the pause that preceded it', () => {
    const todo = { ...DEFAULT_TICK_POLICY, triggerPatterns: [/TODO/] }

    const reasons = evaluateTick(
      event({ at: DEFAULT_TICK_POLICY.pauseMs + 1_000, insertedText: 'TODO' }),
      state({ lastEventAt: 500, lastTickAt: 500 }),
      todo,
    )

    expect(reasons).toEqual(['pattern', 'pause'])
  })

  it('finds nothing to bookmark for a word still being typed', () => {
    const s = state({ lastEventAt: 1_000, lastTickAt: 1_000 })

    expect(evaluateTick(event({ at: 1_100, insertedText: 'endi' }), s)).toEqual([])
  })

  it('bookmarks a formatting change, which inserts no text of its own', () => {
    const reasons = evaluateTick(
      event({ at: 1_100, insertedText: '', isFormatting: true }),
      state({ lastEventAt: 1_000, lastTickAt: 1_000 }),
    )

    expect(reasons).toEqual(['format'])
  })

  it('bookmarks a paste', () => {
    const reasons = evaluateTick(
      event({ at: 1_100, insertedText: 'quoted text', isPaste: true }),
      state({ lastEventAt: 1_000, lastTickAt: 1_000 }),
    )

    expect(reasons).toEqual(['paste'])
  })

  it('bookmarks an attached or removed image', () => {
    const reasons = evaluateTick(
      event({ at: 1_100, insertedText: '', mediaChanged: true }),
      state({ lastEventAt: 1_000, lastTickAt: 1_000 }),
    )

    expect(reasons).toEqual(['media'])
  })

  it('ranks an attached image and a paste above ordinary formatting', () => {
    const reasons = evaluateTick(
      event({ at: 1_100, insertedText: '', isPaste: true, mediaChanged: true, isFormatting: true }),
      state({ lastEventAt: 1_000, lastTickAt: 1_000 }),
    )

    expect(reasons).toEqual(['media', 'paste', 'format'])
  })

  it('ranks a deliberate action above the pause that preceded it', () => {
    const reasons = evaluateTick(
      event({ at: DEFAULT_TICK_POLICY.pauseMs + 1_000, insertedText: 'quoted', isPaste: true }),
      state({ lastEventAt: 500, lastTickAt: 500 }),
    )

    expect(reasons).toEqual(['paste', 'pause'])
  })

  it('bookmarks on the interval so steady typing is never left unmarked', () => {
    const at = DEFAULT_TICK_POLICY.intervalMs + 1_000

    expect(
      evaluateTick(
        event({ at, insertedText: 'a' }),
        state({ lastEventAt: at - 100, lastTickAt: 1_000 }),
      ),
    ).toEqual(['interval'])
  })

  it('honours a tuned policy rather than the defaults', () => {
    const impatient = { ...DEFAULT_TICK_POLICY, pauseMs: 3_000 }

    expect(
      evaluateTick(
        event({ at: 10_000, insertedText: 'x' }),
        state({ lastEventAt: 5_000, lastTickAt: 5_000 }),
        impatient,
      ),
    ).toEqual(['pause'])
  })

  it('leaves a deletion to the session, which alone knows when its run has ended', () => {
    const s = state({ lastEventAt: 1_000, lastTickAt: 1_000 })

    expect(evaluateTick(event({ at: 1_100, insertedText: '' }), s)).toEqual([])
  })
})
