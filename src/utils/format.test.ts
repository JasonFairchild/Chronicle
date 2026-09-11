import { describe, expect, it } from 'vitest'
import { formatDate, toErrorMessage } from '@/utils/format'

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
