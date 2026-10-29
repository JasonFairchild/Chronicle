import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { DEFAULT_MARK_POLICY, deriveMarks, type MarkPolicy } from '@/domain/marks'
import { buildFrames } from '@/editor/markFrames'
import { entryRepository, markSetRepository } from '@/repositories'
import type { MarkSet } from '@/types/markSet'

import { useEntriesStore } from './entriesStore'

/**
 * Mark sets for sealed entries (AUTHORING.md, "Mark sets"). A draft has none: its log is still
 * growing, so it reads `deriveMarks` directly.
 */
export const useMarkSetsStore = defineStore('markSets', () => {
  /** The sets of whichever entry was loaded last. */
  const markSets = shallowRef<MarkSet[]>([])

  /**
   * Builds a set from the entry's trace and saves it. Always a new set, since a name is a label and
   * not a key: retuning a policy makes a new set beside the old one. Null for an entry nothing was
   * typed into, such as an import, which has no session to mark.
   */
  async function createMarkSet(
    entryId: string,
    name: string,
    policy: MarkPolicy = DEFAULT_MARK_POLICY,
  ): Promise<MarkSet | null> {
    const entry = await entryRepository.getById(entryId)
    const events = entry?.authoring_trace?.events
    if (!entry || !events) return null

    // The version the entry revised; a new entry's session starts from `''`, the empty document.
    const base =
      entry.base_version_id === null
        ? ''
        : (await useEntriesStore().getVersion(entry.base_version_id)).content

    const created = await markSetRepository.create({
      entry_id: entryId,
      name,
      policy,
      base_content: base,
      frames: buildFrames({ base_content: base, events }, deriveMarks(events, policy)),
    })

    markSets.value = await markSetRepository.listForEntry(entryId)
    return created
  }

  /**
   * The entry's sets, oldest first, building a default one first if it has none. That keeps
   * building lazy: nothing is spent on an entry until someone opens its history.
   */
  async function loadMarkSets(entryId: string): Promise<void> {
    markSets.value = await markSetRepository.listForEntry(entryId)
    if (markSets.value.length === 0) await createMarkSet(entryId, 'Default')
  }

  async function deleteMarkSet(id: string): Promise<void> {
    await markSetRepository.delete(id)
    markSets.value = markSets.value.filter((set) => set.id !== id)
  }

  return { markSets, createMarkSet, loadMarkSets, deleteMarkSet }
})
