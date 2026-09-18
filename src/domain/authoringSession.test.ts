import { describe, expect, it } from 'vitest'
import { AuthoringSession } from '@/domain/authoringSession'

/** Drives the clock by hand so a session's timing is asserted rather than waited for. */
function fakeClock(start: number) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('AuthoringSession', () => {
  it('records every step in order and bookmarks the moments worth returning to', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession({ sessionId: 'session-1', now: clock.now })

    session.record({ steps: [{ stepType: 'replace', from: 1, to: 1 }], insertedText: 'It rained' })
    clock.advance(200)
    session.record({
      steps: [{ stepType: 'replace', from: 10, to: 10 }],
      insertedText: ' all day.',
    })
    clock.advance(35_000)
    session.record({ steps: [{ stepType: 'replace', from: 19, to: 19 }], insertedText: 'Then' })

    const trace = session.seal()

    expect(trace?.steps).toHaveLength(3)
    expect(trace?.ticks.map((tick) => tick.reason)).toEqual(['punctuation', 'pause'])
    expect(trace?.ticks.map((tick) => tick.step_index)).toEqual([2, 3])
    expect(trace?.session_id).toBe('session-1')
  })

  it('bookmarks a structural anchor op the same way any other session does', () => {
    const session = new AuthoringSession({ sessionId: 'session-anchor' })

    session.record({ steps: [{ stepType: 'addMark' }], isAnchorOp: true })

    expect(session.ticks).toEqual([expect.objectContaining({ step_index: 1, reason: 'anchor' })])
  })

  it('takes a manual bookmark wherever the writer asks for one', () => {
    const session = new AuthoringSession({ sessionId: 'session-2' })

    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'draft' })
    session.mark()

    expect(session.ticks).toEqual([expect.objectContaining({ step_index: 1, reason: 'manual' })])
  })

  it('seals to null when nothing was typed, which is not the same as having no content', () => {
    expect(new AuthoringSession({ sessionId: 'session-3' }).seal()).toBeNull()
  })

  it('resumes an interrupted session with its history intact', () => {
    const session = AuthoringSession.resume({
      sessionId: 'session-4',
      startedAt: '2026-09-05T09:00:00.000Z',
      steps: [{ at: '2026-09-05T09:00:01.000Z', step: { stepType: 'replace' } }],
      ticks: [{ at: '2026-09-05T09:00:01.000Z', step_index: 1, reason: 'punctuation' }],
    })

    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'after the reload.' })
    const trace = session.seal()

    expect(trace?.started_at).toBe('2026-09-05T09:00:00.000Z')
    expect(trace?.steps).toHaveLength(2)
    expect(trace?.ticks.map((tick) => tick.step_index)).toEqual([1, 2])
  })
})
