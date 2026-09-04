import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { reconstructEntryState } from '@/domain/reconstructEntryState'
import { entryRepository } from '@/repositories/inMemoryEntryRepository'
import { createEntryInput, type AggregatedEntry, type Entry } from '@/types/entry'

export const useEntriesStore = defineStore('entries', () => {
  const rootEntries = ref<Entry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const rootCount = computed(() => rootEntries.value.length)

  async function loadRootEntries(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      rootEntries.value = await entryRepository.listRootEntries()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load entries'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createTextEntry(content: string): Promise<Entry> {
    error.value = null
    const trimmed = content.trim()
    if (!trimmed) {
      throw new Error('Entry content cannot be empty')
    }

    const entry = await entryRepository.create(
      createEntryInput({
        type: 'text',
        content: trimmed,
      }),
    )

    rootEntries.value = await entryRepository.listRootEntries()
    return entry
  }

  async function getEntry(id: string): Promise<Entry | null> {
    return entryRepository.getById(id)
  }

  async function getAggregatedEntry(id: string, asOf?: Date): Promise<AggregatedEntry | null> {
    const allEntries = await entryRepository.listAll()
    return reconstructEntryState(id, allEntries, asOf)
  }

  return {
    rootEntries,
    loading,
    error,
    rootCount,
    loadRootEntries,
    createTextEntry,
    getEntry,
    getAggregatedEntry,
  }
})
