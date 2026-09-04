import type { CreateEntryInput, Entry } from '@/types/entry'

export interface EntryRepository {
  create(input: CreateEntryInput): Promise<Entry>
  getById(id: string): Promise<Entry | null>
  listRootEntries(): Promise<Entry[]>
  listAll(): Promise<Entry[]>
  listChildren(parentId: string): Promise<Entry[]>
}
