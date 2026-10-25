import { describe, expect, it } from 'vitest'

import { advanceIdClock, newId } from '@/utils/id'

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

describe('newId', () => {
  it('produces ids that sort in creation order even within one millisecond', () => {
    const ids = Array.from({ length: 50 }, () => newId())

    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces a version 7 UUID', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
