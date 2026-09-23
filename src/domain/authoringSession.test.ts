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
  it('records every edit and manual mark in order, stamped by how far into the session it happened', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession('session-1', '2026-09-05T10:00:00.000Z', '', clock.now)

    session.record({ steps: [{ n: 1 }], inserted_text: 'It rained' })
    clock.advance(2_500)
    session.mark()
    clock.advance(500)
    session.record({ steps: [{ n: 2 }, { n: 3 }], inserted_text: ' all day.' })

    expect(session.events).toEqual([
      { kind: 'edit', at: 0, steps: [{ n: 1 }], inserted_text: 'It rained' },
      { kind: 'manual', at: 2_500 },
      { kind: 'edit', at: 3_000, steps: [{ n: 2 }, { n: 3 }], inserted_text: ' all day.' },
    ])
  })

  it('stores only the signals that are set', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession('session-2', '2026-09-05T10:00:00.000Z', '', clock.now)

    session.record({
      steps: [{ n: 1 }],
      inserted_text: 'a',
      removed_chars: 0,
      is_formatting: false,
      is_anchor_op: false,
      is_paste: false,
      media_changed: false,
    })

    expect(session.events).toEqual([{ kind: 'edit', at: 0, steps: [{ n: 1 }], inserted_text: 'a' }])
  })

  it('seals the document it started from along with the log', () => {
    const session = new AuthoringSession('session-seal', new Date().toISOString(), '{"base":1}')

    session.record({ steps: [{ n: 1 }] })
    const trace = session.seal()

    expect(trace?.session_id).toBe('session-seal')
    expect(trace?.base_content).toBe('{"base":1}')
    expect(trace?.events).toHaveLength(1)
  })

  it('seals to null when nothing was typed, even with a manual mark', () => {
    const session = new AuthoringSession('session-empty', new Date().toISOString(), '')
    expect(session.seal()).toBeNull()

    session.mark()
    expect(session.seal()).toBeNull()
  })

  it('resumes an interrupted session with its log intact', () => {
    // A real clock here would measure this offset from whenever the test happens to run, not from
    // the reload.
    const clock = fakeClock(Date.parse('2026-09-05T09:00:01.500Z'))
    const session = AuthoringSession.resume(
      'session-resume',
      '2026-09-05T09:00:00.000Z',
      '{"base":1}',
      [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }],
      clock.now,
    )

    clock.advance(1_000)
    session.record({ steps: [{ n: 2 }] })
    const trace = session.seal()

    expect(trace?.started_at).toBe('2026-09-05T09:00:00.000Z')
    expect(trace?.base_content).toBe('{"base":1}')
    expect(trace?.events.map((event) => event.at)).toEqual([1_000, 2_500])
  })

  describe('a clock that moves backwards', () => {
    it('keeps offsets climbing when the clock is stepped back mid-session', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-clock-back',
        '2026-09-05T10:00:00.000Z',
        '',
        clock.now,
      )

      session.record({ steps: [] })
      clock.advance(3_000)
      session.record({ steps: [] })
      clock.advance(-2_000) // An NTP correction, a resume from sleep, a hand-set clock.
      session.mark()
      clock.advance(5_000)
      session.record({ steps: [] })

      // The mark reads as having happened at the same instant as the second edit rather than 1s
      // before it, and the last edit goes back to the corrected clock once that passes the floor.
      expect(session.events.map((event) => event.at)).toEqual([0, 3_000, 3_000, 6_000])
    })

    it('never stamps an event before the session began', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-clock-before-start',
        '2026-09-05T10:00:00.000Z',
        '',
        clock.now,
      )

      clock.advance(-10_000)
      session.record({ steps: [] })

      expect(session.events[0]?.at).toBe(0)
      expect(session.seal()?.ended_at).toBe('2026-09-05T10:00:00.000Z')
    })

    it('does not stamp a resumed session behind what the run before the reload recorded', () => {
      // The reload cost a second, but the clock came back 4.5 seconds behind where it left off.
      const clock = fakeClock(Date.parse('2026-09-05T09:00:00.500Z'))
      const session = AuthoringSession.resume(
        'session-clock-resume',
        '2026-09-05T09:00:00.000Z',
        '',
        [
          { kind: 'edit', at: 4_500, steps: [] },
          { kind: 'manual', at: 5_000 },
        ],
        clock.now,
      )

      clock.advance(1_000)
      session.record({ steps: [] })

      // Floored at the manual mark, the latest thing the previous run stamped.
      expect(session.events.map((event) => event.at)).toEqual([4_500, 5_000, 5_000])
    })
  })
})
