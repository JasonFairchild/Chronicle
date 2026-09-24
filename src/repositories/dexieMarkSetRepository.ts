import { newEntryId, newEntryTimestamp } from '@/types/entry'
import { compareMarkSets, type CreateMarkSetInput, type MarkSet } from '@/types/markSet'
import { resolveDatabase, type ChronicleDatabase } from './chronicleDatabase'
import type { MarkSetRepository } from './markSetRepository'

export class DexieMarkSetRepository implements MarkSetRepository {
  private db: ChronicleDatabase

  constructor(database: ChronicleDatabase | string = 'chronicle') {
    this.db = resolveDatabase(database)
  }

  async create(input: CreateMarkSetInput): Promise<MarkSet> {
    const set: MarkSet = { id: newEntryId(), created_at: newEntryTimestamp(), ...input }
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

  /** Test-only: deletes the underlying IndexedDB database and closes this instance. */
  async dispose(): Promise<void> {
    await this.db.delete()
  }
}
