import { describe, expect, it } from 'vitest'

import { compareEntries, createEntryInput, type Entry } from '@/types/entry'

function entryAt(id: string, createdAt: string): Entry {
  return { ...createEntryInput({ content: '' }), id, created_at: createdAt }
}

describe('compareEntries', () => {
  it('orders by created_at when they differ', () => {
    const earlier = entryAt('b', '2026-01-01T00:00:00.000Z')
    const later = entryAt('a', '2026-01-02T00:00:00.000Z')

    expect(compareEntries(earlier, later)).toBeLessThan(0)
    expect(compareEntries(later, earlier)).toBeGreaterThan(0)
  })

  it('ties on id when created_at matches', () => {
    const sameMs = '2026-01-01T00:00:00.000Z'
    const first = entryAt('a', sameMs)
    const second = entryAt('b', sameMs)

    expect(compareEntries(first, second)).toBeLessThan(0)
    expect(compareEntries(second, first)).toBeGreaterThan(0)
  })
})
