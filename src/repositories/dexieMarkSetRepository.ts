import { compareMarkSets, type CreateMarkSetInput, type MarkSet } from '@/types/markSet'
import { newId, newTimestamp } from '@/utils/id'

import type { ChronicleDatabase } from './chronicleDatabase'
import type { MarkSetRepository } from './markSetRepository'

export class DexieMarkSetRepository implements MarkSetRepository {
  constructor(private db: ChronicleDatabase) {}

  async create(input: CreateMarkSetInput): Promise<MarkSet> {
    const set: MarkSet = { id: newId(), created_at: newTimestamp(), ...input }
    await this.db.markSets.add(set)
    return set
  }

  async listForEntry(entryId: string): Promise<MarkSet[]> {
    const sets = await this.db.markSets.where('entry_id').equals(entryId).toArray()
    return sets.sort(compareMarkSets)
  }

  async get(id: string): Promise<MarkSet | null> {
    return (await this.db.markSets.get(id)) ?? null
  }

  async delete(id: string): Promise<void> {
    await this.db.markSets.delete(id)
  }
}
