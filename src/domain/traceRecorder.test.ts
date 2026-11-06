import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TraceRecorder } from '@/domain/traceRecorder'

/** Moves the faked clock, backwards too, so timing is asserted rather than waited for. */
function advanceClock(ms: number): void {
  vi.setSystemTime(Date.now() + ms)
}

describe('TraceRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records every edit and manual mark in order, stamped by how far into the session it happened', () => {
    vi.setSystemTime('2026-09-05T10:00:00.000Z')
    const recorder = new TraceRecorder('session-1', '2026-09-05T10:00:00.000Z')

    recorder.record({ steps: [{ n: 1 }], inserted_text: 'It rained' })
    advanceClock(2_500)
    recorder.mark()
    advanceClock(500)
    recorder.record({ steps: [{ n: 2 }, { n: 3 }], inserted_text: ' all day.' })

    expect(recorder.events).toEqual([
      { kind: 'edit', at: 0, steps: [{ n: 1 }], inserted_text: 'It rained' },
      { kind: 'manual', at: 2_500 },
      { kind: 'edit', at: 3_000, steps: [{ n: 2 }, { n: 3 }], inserted_text: ' all day.' },
    ])
  })

  it('stores only the signals that are set', () => {
    vi.setSystemTime('2026-09-05T10:00:00.000Z')
    const recorder = new TraceRecorder('session-2', '2026-09-05T10:00:00.000Z')

    recorder.record({
      steps: [{ n: 1 }],
      inserted_text: 'a',
      removed_chars: 0,
      is_formatting: false,
      is_anchor_op: false,
      is_paste: false,
      media_changed: false,
    })

    expect(recorder.events).toEqual([
      { kind: 'edit', at: 0, steps: [{ n: 1 }], inserted_text: 'a' },
    ])
  })

  it('seals the session with its log', () => {
    const recorder = new TraceRecorder('session-seal', new Date().toISOString())

    recorder.record({ steps: [{ n: 1 }] })
    const trace = recorder.seal()

    expect(trace?.session_id).toBe('session-seal')
    expect(trace?.events).toHaveLength(1)
  })

  it('seals to null when nothing was typed, even with a manual mark', () => {
    const recorder = new TraceRecorder('session-empty', new Date().toISOString())
    expect(recorder.seal()).toBeNull()

    recorder.mark()
    expect(recorder.seal()).toBeNull()
  })

  it('resumes an interrupted session with its log intact', () => {
    // A real clock here would measure this offset from whenever the test happens to run, not from
    // the reload.
    vi.setSystemTime('2026-09-05T09:00:01.500Z')
    const recorder = TraceRecorder.resume('session-resume', '2026-09-05T09:00:00.000Z', [
      { kind: 'edit', at: 1_000, steps: [{ n: 1 }] },
    ])

    advanceClock(1_000)
    recorder.record({ steps: [{ n: 2 }] })
    const trace = recorder.seal()

    expect(trace?.started_at).toBe('2026-09-05T09:00:00.000Z')
    expect(trace?.events.map((event) => event.at)).toEqual([1_000, 2_500])
  })

  describe('a clock that moves backwards', () => {
    it('keeps offsets climbing when the clock is stepped back mid-session', () => {
      vi.setSystemTime('2026-09-05T10:00:00.000Z')
      const recorder = new TraceRecorder('session-clock-back', '2026-09-05T10:00:00.000Z')

      recorder.record({ steps: [{ n: 1 }] })
      advanceClock(3_000)
      recorder.record({ steps: [{ n: 2 }] })
      advanceClock(-2_000) // An NTP correction, a resume from sleep, a hand-set clock.
      recorder.mark()
      advanceClock(5_000)
      recorder.record({ steps: [{ n: 3 }] })

      // The mark reads as having happened at the same instant as the second edit rather than 1s
      // before it, and the last edit goes back to the corrected clock once that passes the floor.
      expect(recorder.events.map((event) => event.at)).toEqual([0, 3_000, 3_000, 6_000])
    })

    it('never stamps an event before the session began', () => {
      vi.setSystemTime('2026-09-05T10:00:00.000Z')
      const recorder = new TraceRecorder('session-clock-before-start', '2026-09-05T10:00:00.000Z')

      advanceClock(-10_000)
      recorder.record({ steps: [{ n: 1 }] })

      expect(recorder.events[0]?.at).toBe(0)
      expect(recorder.seal()?.ended_at).toBe('2026-09-05T10:00:00.000Z')
    })

    it('does not stamp a resumed session behind what the run before the reload recorded', () => {
      // The reload cost a second, but the clock came back 4.5 seconds behind where it left off.
      vi.setSystemTime('2026-09-05T09:00:00.500Z')
      const recorder = TraceRecorder.resume('session-clock-resume', '2026-09-05T09:00:00.000Z', [
        { kind: 'edit', at: 4_500, steps: [] },
        { kind: 'manual', at: 5_000 },
      ])

      advanceClock(1_000)
      recorder.record({ steps: [{ n: 2 }] })

      // Floored at the manual mark, the latest thing the previous run stamped.
      expect(recorder.events.map((event) => event.at)).toEqual([4_500, 5_000, 5_000])
    })
  })
})
