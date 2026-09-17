import { describe, expect, it } from 'vitest'
import {
  advanceIdClock,
  compareEntries,
  createEntryInput,
  newEntryId,
  type Entry,
} from '@/types/entry'

describe('advanceIdClock', () => {
  it('takes the new millisecond and restarts the counter when the clock moves on', () => {
    expect(advanceIdClock({ ms: 1000, counter: 7 }, 1001)).toEqual({ ms: 1001, counter: 0 })
  })

  it('counts within a millisecond the clock has not left yet', () => {
    expect(advanceIdClock({ ms: 1000, counter: 0 }, 1000)).toEqual({ ms: 1000, counter: 1 })
  })

  it('holds the last millisecond when the clock jumps backwards', () => {
    expect(advanceIdClock({ ms: 1000, counter: 3 }, 400)).toEqual({ ms: 1000, counter: 4 })
  })

  it('borrows the next millisecond when the counter runs out of bits', () => {
    expect(advanceIdClock({ ms: 1000, counter: 0x0fff }, 1000)).toEqual({ ms: 1001, counter: 0 })
  })
})

describe('newEntryId', () => {
  it('produces ids that sort in creation order even within one millisecond', () => {
    const ids = Array.from({ length: 50 }, () => newEntryId())

    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces a version 7 UUID', () => {
    expect(newEntryId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

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
