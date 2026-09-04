import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEntriesStore } from '@/stores/entriesStore'
import { entryRepository } from '@/repositories/inMemoryEntryRepository'

describe('useEntriesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    entryRepository.clear()
  })

  it('creates a text entry and refreshes the root timeline', async () => {
    const store = useEntriesStore()

    await store.createTextEntry('First timeline entry')
    await store.loadRootEntries()

    expect(store.rootCount).toBe(1)
    expect(store.rootEntries[0]?.content).toBe('First timeline entry')
  })

  it('rejects empty content', async () => {
    const store = useEntriesStore()
    await expect(store.createTextEntry('   ')).rejects.toThrow('Entry content cannot be empty')
  })

  it('returns aggregated entry state from the repository data', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('Root content')

    const aggregated = await store.getAggregatedEntry(created.id)
    expect(aggregated?.content).toBe('Root content')
  })
})
