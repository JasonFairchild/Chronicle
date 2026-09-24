import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { DEFAULT_MARK_POLICY, deriveMarks, type MarkPolicy } from '@/domain/marks'
import { buildFrames } from '@/editor/markFrames'
import { entryRepository, markSetRepository } from '@/repositories'
import type { MarkSet } from '@/types/markSet'

/**
 * Mark sets for sealed entries (ENTRY_MODEL.md, "Mark sets"). A draft has none: its log is still
 * growing, so it reads `deriveMarks` directly.
 */
export const useMarkSetsStore = defineStore('markSets', () => {
  const markSets = shallowRef<MarkSet[]>([]) // The sets of whichever entry was loaded last.

  /**
   * The entry's sets, oldest first, building a default one first if it has none. That keeps
   * building lazy: nothing is spent on an entry until someone opens its history.
   */
  async function loadMarkSets(entryId: string): Promise<void> {
    markSets.value = await markSetRepository.listForEntry(entryId)
    if (markSets.value.length === 0) await createMarkSet(entryId, 'Default')
  }

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
    const trace = (await entryRepository.getById(entryId))?.authoring_trace
    if (!trace) return null

    const created = await markSetRepository.create({
      entry_id: entryId,
      name,
      policy,
      base_content: trace.base_content,
      frames: buildFrames(trace, deriveMarks(trace.events, policy)),
    })

    markSets.value = await markSetRepository.listForEntry(entryId)
    return created
  }

  async function deleteMarkSet(id: string): Promise<void> {
    await markSetRepository.delete(id)
    markSets.value = markSets.value.filter((set) => set.id !== id)
  }

  return { markSets, loadMarkSets, createMarkSet, deleteMarkSet }
})
