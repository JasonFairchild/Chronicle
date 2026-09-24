import { newEntryId, newEntryTimestamp } from '@/types/entry'
import { compareMarkSets, type CreateMarkSetInput, type MarkSet } from '@/types/markSet'
import type { MarkSetRepository } from './markSetRepository'

export class InMemoryMarkSetRepository implements MarkSetRepository {
  private sets = new Map<string, MarkSet>()

  async create(input: CreateMarkSetInput): Promise<MarkSet> {
    const set: MarkSet = { id: newEntryId(), created_at: newEntryTimestamp(), ...input }
    this.sets.set(set.id, structuredClone(set))
    return structuredClone(set)
  }

  async listForEntry(entryId: string): Promise<MarkSet[]> {
    return [...this.sets.values()]
      .filter((set) => set.entry_id === entryId)
      .sort(compareMarkSets)
      .map((set) => structuredClone(set))
  }

  async get(id: string): Promise<MarkSet | null> {
    const set = this.sets.get(id)
    return set ? structuredClone(set) : null
  }

  async delete(id: string): Promise<void> {
    this.sets.delete(id)
  }
}
