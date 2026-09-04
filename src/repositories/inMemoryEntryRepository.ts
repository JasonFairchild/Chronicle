import { newEntryId, newEntryTimestamp, type CreateEntryInput, type Entry } from '@/types/entry'
import type { EntryRepository } from './entryRepository'

export class InMemoryEntryRepository implements EntryRepository {
  private entries = new Map<string, Entry>()

  async create(input: CreateEntryInput): Promise<Entry> {
    const entry: Entry = {
      id: newEntryId(),
      created_at: newEntryTimestamp(),
      ...input,
    }
    this.entries.set(entry.id, entry)
    return structuredClone(entry)
  }

  async getById(id: string): Promise<Entry | null> {
    const entry = this.entries.get(id)
    return entry ? structuredClone(entry) : null
  }

  async listRootEntries(): Promise<Entry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.parent_id === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((entry) => structuredClone(entry))
  }

  async listAll(): Promise<Entry[]> {
    return [...this.entries.values()]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((entry) => structuredClone(entry))
  }

  async listChildren(parentId: string): Promise<Entry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.parent_id === parentId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((entry) => structuredClone(entry))
  }

  /** Test helper — seed entries directly */
  seed(entries: Entry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.id, structuredClone(entry))
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const entryRepository = new InMemoryEntryRepository()
