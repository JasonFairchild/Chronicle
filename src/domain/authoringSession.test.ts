import { describe, expect, it } from 'vitest'
import { AuthoringSession } from '@/domain/authoringSession'
import { DEFAULT_TICK_POLICY } from '@/domain/tickPolicy'

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
    const session = new AuthoringSession('session-1', '2026-09-05T10:00:00.000Z', clock.now)

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
    expect(trace?.ticks.map((tick) => tick.reasons)).toEqual([['punctuation'], ['pause']])
    expect(trace?.ticks.map((tick) => tick.step_index)).toEqual([2, 3])
    expect(trace?.session_id).toBe('session-1')
  })

  it('stamps each step by how far into the session it happened', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession('session-offsets', '2026-09-05T10:00:00.000Z', clock.now)

    session.record({ steps: [{ stepType: 'replace' }] })
    clock.advance(2_500)
    session.record({ steps: [{ stepType: 'replace' }] })

    expect(session.steps.map((step) => step.at)).toEqual([0, 2_500])
  })

  it('stamps a tick at the same moment as the step it bookmarks', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession('session-sync', '2026-09-05T10:00:00.000Z', clock.now)

    clock.advance(1_500)
    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'Done.' })

    expect(session.ticks[0]?.at).toBe(session.steps[0]?.at)
  })

  it('bookmarks once for a change several rules agree on, not once per rule', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession('session-multi', '2026-09-05T10:00:00.000Z', clock.now)

    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'It rained' })
    clock.advance(35_000)
    session.record({ steps: [{ stepType: 'replace' }], insertedText: ' all day.' })

    expect(session.ticks).toHaveLength(1)
    expect(session.ticks[0]?.reasons).toEqual(['pause', 'punctuation'])
  })

  it('merges a tick landing within the density window into the previous one, rather than adding a second', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession('session-density', '2026-09-05T10:00:00.000Z', clock.now)

    session.record({ steps: [{ stepType: 'addMark' }], isFormatting: true })
    clock.advance(500)
    session.record({ steps: [{ stepType: 'addMark' }], isFormatting: true })

    expect(session.ticks).toHaveLength(1)
    expect(session.ticks[0]?.reasons).toEqual(['format'])
    // The merged tick moves up to the second change's position, not the first's — it now
    // represents the end of this cluster, not its start.
    expect(session.ticks[0]?.step_index).toBe(2)
  })

  it('brings a new reason into a merged tick, rather than only ever keeping the first', () => {
    const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
    const session = new AuthoringSession(
      'session-density-union',
      '2026-09-05T10:00:00.000Z',
      clock.now,
    )

    session.record({ steps: [{ stepType: 'addMark' }], isFormatting: true })
    clock.advance(500)
    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'Done.' })

    expect(session.ticks).toHaveLength(1)
    expect(session.ticks[0]?.reasons).toEqual(['format', 'punctuation'])
  })

  describe('deletion', () => {
    it('bookmarks a deletion of any size at its last step once something else happens', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-deletion',
        '2026-09-05T10:00:00.000Z',
        clock.now,
      )

      session.record({ steps: [{ stepType: 'replace' }], removedChars: 1 })
      clock.advance(100)
      session.record({ steps: [{ stepType: 'replace' }], removedChars: 1 })
      expect(session.ticks).toHaveLength(0)

      clock.advance(100)
      session.record({ steps: [{ stepType: 'replace' }], insertedText: 'a' })

      // Step 2 is the last backspace; the typed "a" that ended the run is step 3, after the tick.
      expect(session.ticks).toEqual([
        expect.objectContaining({ step_index: 2, reasons: ['deletion'] }),
      ])
    })

    it('ends a run at a pause, bookmarking the burst before it and starting a new one', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-deletion-pause',
        '2026-09-05T10:00:00.000Z',
        clock.now,
      )

      session.record({ steps: [{ stepType: 'replace' }], removedChars: 5 })
      clock.advance(DEFAULT_TICK_POLICY.pauseMs + 1_000)
      session.record({ steps: [{ stepType: 'replace' }], removedChars: 5 })

      expect(session.ticks.map((tick) => [tick.step_index, tick.reasons])).toEqual([
        [1, ['deletion']],
        [2, ['pause']],
      ])

      // Past `minTickGapMs` from the `pause` tick, so the second burst's own end is a tick of its own.
      clock.advance(DEFAULT_TICK_POLICY.minTickGapMs + 1_000)
      session.record({ steps: [{ stepType: 'replace' }], removedChars: 5 })
      clock.advance(100)
      session.record({ steps: [{ stepType: 'replace' }], insertedText: 'a' })

      expect(session.ticks[2]).toEqual(
        expect.objectContaining({ step_index: 3, reasons: ['deletion'] }),
      )
    })

    it('lets the interval bookmark a long unbroken run without ending it', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-deletion-interval',
        '2026-09-05T10:00:00.000Z',
        clock.now,
      )

      // Runs past the interval so its tick lands mid-run, with a gap before the run's own end
      // that clears `minTickGapMs` — otherwise the two would merge into one.
      for (let elapsed = 0; elapsed <= DEFAULT_TICK_POLICY.intervalMs + 10_000; elapsed += 5_000) {
        session.record({ steps: [{ stepType: 'replace' }], removedChars: 1 })
        clock.advance(5_000)
      }
      expect(session.ticks.map((tick) => tick.reasons)).toEqual([['interval']])

      session.record({ steps: [{ stepType: 'replace' }], insertedText: 'a' })
      expect(session.ticks.map((tick) => tick.reasons)).toEqual([['interval'], ['deletion']])
    })

    it('closes a run still open when the trace is sealed', () => {
      const session = new AuthoringSession('session-deletion-seal', new Date().toISOString())

      session.record({ steps: [{ stepType: 'replace' }], removedChars: 3 })

      expect(session.seal()?.ticks).toEqual([
        expect.objectContaining({ step_index: 1, reasons: ['deletion'] }),
      ])
    })
  })

  it('bookmarks a structural anchor op the same way any other session does', () => {
    const session = new AuthoringSession('session-anchor', new Date().toISOString())

    session.record({ steps: [{ stepType: 'addMark' }], isAnchorOp: true })

    expect(session.ticks).toEqual([expect.objectContaining({ step_index: 1, reasons: ['anchor'] })])
  })

  it('takes a manual bookmark wherever the writer asks for one', () => {
    const session = new AuthoringSession('session-2', new Date().toISOString())

    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'draft' })
    session.mark()

    expect(session.ticks).toEqual([expect.objectContaining({ step_index: 1, reasons: ['manual'] })])
  })

  it('seals to null when nothing was typed, which is not the same as having no content', () => {
    expect(new AuthoringSession('session-3', new Date().toISOString()).seal()).toBeNull()
  })

  it('resumes an interrupted session with its history intact', () => {
    // A real clock here would measure this offset from whenever the test happens to run, not from
    // the reload — `startedAt` is nearly 2 seconds in the past, so an uninjected clock would put
    // real-world days between them instead of the single second this test means to describe.
    const clock = fakeClock(Date.parse('2026-09-05T09:00:01.500Z'))
    const session = AuthoringSession.resume(
      'session-4',
      '2026-09-05T09:00:00.000Z',
      {
        steps: [{ at: 1_000, step: { stepType: 'replace' } }],
        ticks: [{ at: 1_000, step_index: 1, reasons: ['punctuation'] }],
      },
      clock.now,
    )

    // Past `minTickGapMs`, so the new tick this produces doesn't merge into the seeded one — a
    // resumed session's own construction seeds `lastTickAt` at essentially this same instant, and
    // this test means to show two ticks preserved intact, not exercise the merge behavior.
    clock.advance(DEFAULT_TICK_POLICY.minTickGapMs + 1_000)
    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'after the reload.' })
    const trace = session.seal()

    expect(trace?.started_at).toBe('2026-09-05T09:00:00.000Z')
    expect(trace?.steps).toHaveLength(2)
    expect(trace?.steps[1]?.at).toBe(1_500 + DEFAULT_TICK_POLICY.minTickGapMs + 1_000)
    expect(trace?.ticks.map((tick) => tick.step_index)).toEqual([1, 2])
  })

  it('bookmarks the first keystroke after a reload as a return from silence', () => {
    const clock = fakeClock(Date.parse('2026-09-05T09:00:01.000Z'))
    const session = AuthoringSession.resume(
      'session-resume-pause',
      '2026-09-05T09:00:00.000Z',
      { steps: [{ at: 1_000, step: { stepType: 'replace' } }], ticks: [] },
      clock.now,
    )

    clock.advance(DEFAULT_TICK_POLICY.pauseMs + 1_000)
    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'Back again' })

    expect(session.ticks).toHaveLength(1)
    expect(session.ticks[0]?.reasons).toContain('pause')
  })

  describe('a clock that moves backwards', () => {
    it('keeps step offsets climbing when the clock is stepped back mid-session', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-clock-back',
        '2026-09-05T10:00:00.000Z',
        clock.now,
      )

      session.record({ steps: [{ stepType: 'replace' }] })
      clock.advance(3_000)
      session.record({ steps: [{ stepType: 'replace' }] })
      clock.advance(-2_000) // An NTP correction, a resume from sleep, a hand-set clock.
      session.record({ steps: [{ stepType: 'replace' }] })
      clock.advance(5_000)
      session.record({ steps: [{ stepType: 'replace' }] })

      // The third step reads as having happened at the same instant as the second rather than
      // 1s before it, and the fourth goes back to the corrected clock once that passes the floor.
      expect(session.steps.map((step) => step.at)).toEqual([0, 3_000, 3_000, 6_000])
    })

    it('never stamps a step before the session began', () => {
      const clock = fakeClock(Date.parse('2026-09-05T10:00:00.000Z'))
      const session = new AuthoringSession(
        'session-clock-before-start',
        '2026-09-05T10:00:00.000Z',
        clock.now,
      )

      clock.advance(-10_000)
      session.record({ steps: [{ stepType: 'replace' }] })

      expect(session.steps[0]?.at).toBe(0)
      expect(session.seal()?.ended_at).toBe('2026-09-05T10:00:00.000Z')
    })

    it('does not stamp a resumed session behind what the run before the reload recorded', () => {
      // The reload cost a second, but the clock came back 4 seconds behind where it left off.
      const clock = fakeClock(Date.parse('2026-09-05T09:00:00.500Z'))
      const session = AuthoringSession.resume(
        'session-clock-resume',
        '2026-09-05T09:00:00.000Z',
        {
          steps: [{ at: 4_500, step: { stepType: 'replace' } }],
          ticks: [{ at: 5_000, step_index: 1, reasons: ['manual'] }],
        },
        clock.now,
      )

      clock.advance(1_000)
      session.record({ steps: [{ stepType: 'replace' }] })

      // Floored at the last tick, the latest thing the previous run stamped — not at the last step.
      expect(session.steps.map((step) => step.at)).toEqual([4_500, 5_000])
    })
  })

  it('does not bookmark a draft picked straight back up', () => {
    const clock = fakeClock(Date.parse('2026-09-05T09:00:01.000Z'))
    const session = AuthoringSession.resume(
      'session-resume-fast',
      '2026-09-05T09:00:00.000Z',
      { steps: [{ at: 1_000, step: { stepType: 'replace' } }], ticks: [] },
      clock.now,
    )

    clock.advance(200)
    session.record({ steps: [{ stepType: 'replace' }], insertedText: 'Still here' })

    expect(session.ticks).toHaveLength(0)
  })
})
