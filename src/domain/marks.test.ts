import { describe, expect, it } from 'vitest'
import { DEFAULT_MARK_POLICY, deriveMarks } from '@/domain/marks'
import type { ChangeSignals, EditEvent, ManualEvent } from '@/types/entry'

/** An edit carrying only the signals a test sets. `deriveMarks` never reads the steps. */
function edit(at: number, signals: Partial<ChangeSignals> = {}): EditEvent {
  return { kind: 'edit', at, steps: [], ...signals }
}

function manual(at: number): ManualEvent {
  return { kind: 'manual', at }
}

const { pauseMs, intervalMs, minMarkGapMs } = DEFAULT_MARK_POLICY

describe('deriveMarks', () => {
  it('marks a sentence finished after a silence once, for both reasons', () => {
    const marks = deriveMarks([
      edit(5_000, { inserted_text: 'It rained' }),
      edit(5_000 + pauseMs, { inserted_text: ' all day.' }),
    ])

    expect(marks).toEqual([{ at: 5_000 + pauseMs, index: 2, reasons: ['pause', 'punctuation'] }])
  })

  it('orders the reasons it found by priority, so the first is the one worth showing', () => {
    const [mark] = deriveMarks([edit(100, { is_formatting: true, is_anchor_op: true })])

    expect(mark?.reasons).toEqual(['anchor', 'format'])
  })

  it('marks a finished sentence but not a word still being typed', () => {
    const marks = deriveMarks([
      edit(100, { inserted_text: 'endi' }),
      edit(200, { inserted_text: 'end.' }),
    ])

    expect(marks).toEqual([{ at: 200, index: 2, reasons: ['punctuation'] }])
  })

  it('honours a tuned punctuation set, so a semicolon ends a unit only when asked to', () => {
    const semicolons = { ...DEFAULT_MARK_POLICY, punctuation: ';' }

    expect(deriveMarks([edit(100, { inserted_text: 'a;' })])).toEqual([])
    expect(deriveMarks([edit(100, { inserted_text: 'a;' })], semicolons)).toEqual([
      { at: 100, index: 1, reasons: ['punctuation'] },
    ])
    expect(deriveMarks([edit(100, { inserted_text: 'a.' })], semicolons)).toEqual([])
  })

  it('marks text matching a configured pattern as its own reason, ranked above a pause', () => {
    const todo = { ...DEFAULT_MARK_POLICY, triggerPatterns: [/TODO/] }
    const log = [edit(500), edit(500 + pauseMs, { inserted_text: 'TODO' })]

    expect(deriveMarks(log)[0]?.reasons).toEqual(['pause'])
    expect(deriveMarks(log, todo)[0]?.reasons).toEqual(['pattern', 'pause'])
  })

  it('marks a formatting change, which inserts no text of its own', () => {
    expect(deriveMarks([edit(100, { is_formatting: true })])).toEqual([
      { at: 100, index: 1, reasons: ['format'] },
    ])
  })

  it('marks a structural anchor op', () => {
    expect(deriveMarks([edit(100, { is_anchor_op: true })])).toEqual([
      { at: 100, index: 1, reasons: ['anchor'] },
    ])
  })

  it('marks a paste from the signal stored with the edit', () => {
    const marks = deriveMarks([edit(100, { inserted_text: 'quoted text', is_paste: true })])

    expect(marks[0]?.reasons).toEqual(['paste'])
  })

  it('marks an attached or removed image', () => {
    expect(deriveMarks([edit(100, { media_changed: true })])[0]?.reasons).toEqual(['media'])
  })

  it('ranks an attached image and a paste above ordinary formatting', () => {
    const [mark] = deriveMarks([
      edit(100, { is_paste: true, media_changed: true, is_formatting: true }),
    ])

    expect(mark?.reasons).toEqual(['media', 'paste', 'format'])
  })

  it('ranks a deliberate action above the pause that preceded it', () => {
    const [mark] = deriveMarks([
      edit(500),
      edit(500 + pauseMs, { inserted_text: 'quoted', is_paste: true }),
    ])

    expect(mark?.reasons).toEqual(['paste', 'pause'])
  })

  it('marks on the interval so steady typing is never left unmarked', () => {
    // A keystroke every 10s: never a pause, never a sentence end.
    const log = Array.from({ length: 7 }, (_, i) => edit(i * 10_000, { inserted_text: 'a' }))

    expect(deriveMarks(log)).toEqual([{ at: intervalMs, index: 7, reasons: ['interval'] }])
  })

  it('reads a reload as nothing more than the gap it left in the log', () => {
    const marks = deriveMarks([
      edit(1_000, { inserted_text: 'Before' }),
      edit(1_000 + intervalMs, { inserted_text: 'After' }),
    ])

    expect(marks[0]?.reasons).toEqual(['pause', 'interval'])
  })

  it('derives different marks from the same log under a different policy', () => {
    const log = [
      edit(0, { inserted_text: 'It rained' }),
      edit(5_000, { inserted_text: ' all day;' }),
    ]
    const tuned = { ...DEFAULT_MARK_POLICY, pauseMs: 3_000, punctuation: ';' }

    expect(deriveMarks(log)).toEqual([])
    expect(deriveMarks(log, tuned)).toEqual([
      { at: 5_000, index: 2, reasons: ['pause', 'punctuation'] },
    ])
  })

  describe('merging nearby marks', () => {
    it('merges a mark within the gap into the previous one, which moves to the end of the cluster', () => {
      const marks = deriveMarks([
        edit(0, { is_formatting: true }),
        edit(500, { is_formatting: true }),
      ])

      expect(marks).toEqual([{ at: 500, index: 2, reasons: ['format'] }])
    })

    it('brings a new reason into a merged mark, rather than only ever keeping the first', () => {
      const marks = deriveMarks([
        edit(0, { is_formatting: true }),
        edit(500, { inserted_text: 'Done.' }),
      ])

      expect(marks[0]?.reasons).toEqual(['format', 'punctuation'])
    })

    it('keeps a mark exactly the gap after the previous one as its own', () => {
      const marks = deriveMarks([
        edit(0, { is_formatting: true }),
        edit(minMarkGapMs, { is_formatting: true }),
      ])

      expect(marks.map((mark) => mark.index)).toEqual([1, 2])
    })

    it('measures the gap from the merged mark, so a steady cluster stays one mark', () => {
      const marks = deriveMarks([
        edit(0, { is_formatting: true }),
        edit(1_500, { is_formatting: true }),
        edit(3_000, { is_formatting: true }),
      ])

      expect(marks).toEqual([{ at: 3_000, index: 3, reasons: ['format'] }])
    })
  })

  describe('a manual mark', () => {
    it('stays apart from a mark the policy placed a moment before', () => {
      const marks = deriveMarks([edit(0, { inserted_text: 'Done.' }), manual(500)])

      expect(marks).toEqual([
        { at: 0, index: 1, reasons: ['punctuation'] },
        { at: 500, index: 2, reasons: ['manual'] },
      ])
    })

    it('stays where it was when the policy places a mark a moment after', () => {
      const marks = deriveMarks([
        edit(0, { inserted_text: 'Done' }),
        manual(100),
        edit(500, { inserted_text: '.' }),
      ])

      expect(marks).toEqual([
        { at: 100, index: 2, reasons: ['manual'] },
        { at: 500, index: 3, reasons: ['punctuation'] },
      ])
    })

    it('stays apart from another manual mark, however close', () => {
      const marks = deriveMarks([edit(0, { inserted_text: 'draft' }), manual(0), manual(100)])

      expect(marks).toEqual([
        { at: 0, index: 2, reasons: ['manual'] },
        { at: 100, index: 3, reasons: ['manual'] },
      ])
    })
  })

  describe('a deletion run', () => {
    it('is marked at its last deleting edit once something else happens', () => {
      const marks = deriveMarks([
        edit(0, { removed_chars: 1 }),
        edit(100, { removed_chars: 1 }),
        edit(200, { inserted_text: 'a' }),
      ])

      // The typed "a" that ended the run is event 3, after the mark.
      expect(marks).toEqual([{ at: 100, index: 2, reasons: ['deletion'] }])
    })

    it('ends at a pause, which marks the burst before it and starts a new one', () => {
      const secondBurst = pauseMs + 1_000
      const marks = deriveMarks([
        edit(0, { removed_chars: 5 }),
        edit(secondBurst, { removed_chars: 5 }),
        edit(secondBurst + minMarkGapMs + 1_000, { removed_chars: 5 }),
        edit(secondBurst + minMarkGapMs + 1_100, { inserted_text: 'a' }),
      ])

      expect(marks.map((mark) => [mark.index, mark.reasons])).toEqual([
        [1, ['deletion']],
        [2, ['pause']],
        [3, ['deletion']],
      ])
    })

    it('lets the interval mark a long unbroken run without ending it', () => {
      // Runs past the interval so its mark lands mid-run, with a gap before the run's own end that
      // clears `minMarkGapMs` — otherwise the two would merge into one.
      const run = Array.from({ length: 15 }, (_, i) => edit(i * 5_000, { removed_chars: 1 }))
      const marks = deriveMarks([...run, edit(75_000, { inserted_text: 'a' })])

      expect(marks.map((mark) => mark.reasons)).toEqual([['interval'], ['deletion']])
    })

    it('merges its end into a mark placed on its own last edit', () => {
      const marks = deriveMarks([
        edit(0, { inserted_text: 'a' }),
        edit(pauseMs + 1_000, { removed_chars: 1 }),
        edit(pauseMs + 1_100, { inserted_text: 'b' }),
      ])

      expect(marks).toEqual([{ at: pauseMs + 1_000, index: 2, reasons: ['deletion', 'pause'] }])
    })

    it('ends at a manual mark, so its mark never lands behind the writer’s', () => {
      const marks = deriveMarks([
        edit(0, { removed_chars: 1 }),
        manual(20_000),
        edit(21_000, { inserted_text: 'a' }),
      ])

      expect(marks).toEqual([
        { at: 0, index: 1, reasons: ['deletion'] },
        { at: 20_000, index: 2, reasons: ['manual'] },
      ])
    })

    it('stays apart from the manual mark that ended it a moment later', () => {
      const marks = deriveMarks([edit(0, { removed_chars: 1 }), manual(1_000)])

      expect(marks).toEqual([
        { at: 0, index: 1, reasons: ['deletion'] },
        { at: 1_000, index: 2, reasons: ['manual'] },
      ])
    })

    it('is closed by the end of the log', () => {
      expect(deriveMarks([edit(0, { removed_chars: 3 })])).toEqual([
        { at: 0, index: 1, reasons: ['deletion'] },
      ])
    })
  })
})
