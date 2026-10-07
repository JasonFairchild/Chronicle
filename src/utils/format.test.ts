import { describe, expect, it } from 'vitest'
import { emptyEntryDates, emptyEntryDetails } from '@/types/entry'
import { entryDetailLines, entryWhenLines, formatDate, toErrorMessage } from '@/utils/format'

describe('formatDate', () => {
  // The locale is the browser's on purpose, so these assert what the format *carries* rather than
  // pinning an exact string that would read differently on a machine set to another locale.
  it('renders an instant with its time, and a fuller date when asked for one', () => {
    const medium = formatDate('2026-09-11T15:04:05.000Z')
    const full = formatDate('2026-09-11T15:04:05.000Z', 'full')

    expect(medium).toContain('2026')
    expect(full).toContain('2026')
    expect(full.length).toBeGreaterThan(medium.length)
  })
})

describe('entryWhenLines', () => {
  // A date-only string handed to `new Date()` is read as UTC midnight, which is the day *before*
  // anywhere west of Greenwich. The day a person typed has to survive being shown back to them.
  it('labels each date it was given, keeping the day as entered', () => {
    const lines = entryWhenLines({
      occurred_at: '1994-06-12',
      occurred_time_note: 'morning',
      recorded_at: '1994-06-13',
      recorded_time_note: null,
    })

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Happened')
    expect(lines[0]).toContain('12')
    expect(lines[0]).toContain('· morning')
    expect(lines[1]).toContain('Originally written')
    expect(lines[1]).toContain('13')
  })

  it('keeps a time with no date, since a remembered hour is still an answer', () => {
    const lines = entryWhenLines({
      ...emptyEntryDates(),
      occurred_time_note: '3:30 pm',
    })

    expect(lines).toEqual(['Happened 3:30 pm'])
  })

  it('says nothing at all when nothing was given', () => {
    expect(entryWhenLines(emptyEntryDates())).toEqual([])
    expect(entryWhenLines({ ...emptyEntryDates(), occurred_time_note: '   ' })).toEqual([])
  })

  it('shows anything not shaped like a day exactly as stored, not as an invalid date', () => {
    expect(entryWhenLines({ ...emptyEntryDates(), occurred_at: 'sometime in June' })).toEqual([
      'Happened sometime in June',
    ])
  })
})

describe('entryDetailLines', () => {
  // Time notes rather than days, so the lines don't depend on the machine's locale.
  it('lists every detail given, in the order the form asks for them', () => {
    const lines = entryDetailLines({
      dates: { ...emptyEntryDates(), occurred_time_note: 'morning', recorded_time_note: 'evening' },
      location: 'home',
      original_medium: 'paper journal',
      original_medium_note: 'blue Moleskine',
    })

    expect(lines).toEqual([
      'Happened morning',
      'Where: home',
      'Originally written evening',
      'Written in paper journal · blue Moleskine',
    ])
  })

  it('keeps a note on what it was written in, even without the medium itself', () => {
    expect(
      entryDetailLines({ ...emptyEntryDetails(), original_medium_note: 'blue Moleskine' }),
    ).toEqual(['Written in blue Moleskine'])
  })

  it('says nothing at all when nothing was given', () => {
    expect(entryDetailLines(emptyEntryDetails())).toEqual([])
    expect(entryDetailLines({ ...emptyEntryDetails(), location: '   ' })).toEqual([])
  })
})

describe('toErrorMessage', () => {
  it('prefers what the error actually says', () => {
    expect(toErrorMessage(new Error('Draft session not found'), 'Failed to save entry')).toBe(
      'Draft session not found',
    )
  })

  it('falls back for anything that cannot speak for itself', () => {
    expect(toErrorMessage('a bare string', 'Failed to save entry')).toBe('Failed to save entry')
    expect(toErrorMessage(new Error(''), 'Failed to save entry')).toBe('Failed to save entry')
  })
})
