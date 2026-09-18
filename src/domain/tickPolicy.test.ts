import { describe, expect, it } from 'vitest'
import { DEFAULT_TICK_POLICY, evaluateTick } from '@/domain/tickPolicy'

describe('evaluateTick', () => {
  it('bookmarks a return from silence, and prefers that over the sentence that broke it', () => {
    const at = DEFAULT_TICK_POLICY.pauseMs + 5_000

    const reason = evaluateTick(
      { at, insertedText: '.', isFormatting: false, isAnchorOp: false },
      { lastEventAt: 5_000, lastTickAt: 5_000 },
    )

    expect(reason).toBe('pause')
  })

  it('bookmarks a finished sentence but not a word still being typed', () => {
    const state = { lastEventAt: 1_000, lastTickAt: 1_000 }

    expect(
      evaluateTick(
        { at: 1_100, insertedText: 'end.', isFormatting: false, isAnchorOp: false },
        state,
      ),
    ).toBe('punctuation')
    expect(
      evaluateTick(
        { at: 1_100, insertedText: 'endi', isFormatting: false, isAnchorOp: false },
        state,
      ),
    ).toBeNull()
  })

  it('bookmarks a structural anchor op, and prefers that over ordinary formatting', () => {
    const reason = evaluateTick(
      { at: 1_100, insertedText: '', isFormatting: true, isAnchorOp: true },
      { lastEventAt: 1_000, lastTickAt: 1_000 },
    )

    expect(reason).toBe('anchor')
  })

  it('bookmarks a formatting change, which inserts no text of its own', () => {
    const reason = evaluateTick(
      { at: 1_100, insertedText: '', isFormatting: true, isAnchorOp: false },
      { lastEventAt: 1_000, lastTickAt: 1_000 },
    )

    expect(reason).toBe('format')
  })

  it('bookmarks on the interval so steady typing is never left unmarked', () => {
    const at = DEFAULT_TICK_POLICY.intervalMs + 1_000

    expect(
      evaluateTick(
        { at, insertedText: 'a', isFormatting: false, isAnchorOp: false },
        { lastEventAt: at - 100, lastTickAt: 1_000 },
      ),
    ).toBe('interval')
  })

  it('honours a tuned policy rather than the defaults', () => {
    const impatient = { ...DEFAULT_TICK_POLICY, pauseMs: 3_000 }

    expect(
      evaluateTick(
        { at: 10_000, insertedText: 'x', isFormatting: false, isAnchorOp: false },
        { lastEventAt: 5_000, lastTickAt: 5_000 },
        impatient,
      ),
    ).toBe('pause')
  })
})
