import { describe, expect, it } from 'vitest'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { runEntryRepositoryContract } from '@/repositories/entryRepository.contract'
import { newEntryId } from '@/types/entry'

runEntryRepositoryContract('in-memory', () => new InMemoryEntryRepository())

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
