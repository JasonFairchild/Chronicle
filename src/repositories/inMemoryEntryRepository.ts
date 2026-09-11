import {
  compareEntries,
  newEntryId,
  newEntryTimestamp,
  type CreateEntryInput,
  type Entry,
} from '@/types/entry'
import { assertValidRelation } from '@/domain/entryValidation'
import type { EntryRepository } from './entryRepository'

export class InMemoryEntryRepository implements EntryRepository {
  private entries = new Map<string, Entry>()

  async create(input: CreateEntryInput): Promise<Entry> {
    await assertValidRelation(input, (id) => this.entries.get(id))

    const entry: Entry = {
      id: newEntryId(),
      created_at: newEntryTimestamp(),
      // Cloned on the way in as well as out. A plain spread is shallow, so `anchors`, `media_refs`,
      // and `metadata` would stay shared with the caller's object and mutating an input after
      // saving would quietly rewrite stored history.
      ...structuredClone(input),
    }

    this.entries.set(entry.id, entry)
    return structuredClone(entry)
  }

  async getById(id: string): Promise<Entry | null> {
    const entry = this.entries.get(id)
    return entry ? structuredClone(entry) : null
  }

  async listRootEntries(): Promise<Entry[]> {
    return this.collect(
      (entry) => entry.relation_type === null,
      (a, b) => compareEntries(b, a),
    )
  }

  async listChildren(parentId: string): Promise<Entry[]> {
    return this.collect(
      (entry) => entry.parent_id === parentId && entry.relation_type !== 'revision',
    )
  }

  async listRevisions(entryId: string): Promise<Entry[]> {
    return this.collect(
      (entry) => entry.parent_id === entryId && entry.relation_type === 'revision',
    )
  }

  async listConnectionsFor(entryId: string): Promise<Entry[]> {
    return this.collect(
      (entry) =>
        entry.relation_type === 'connection' &&
        (entry.parent_id === entryId || entry.target_id === entryId),
    )
  }

  async listDescendants(rootId: string): Promise<Entry[]> {
    if (!this.entries.has(rootId)) return []

    const all = [...this.entries.values()]
    const subtree = new Set<string>([rootId])

    // Containment follows parent_id only. Repeating until nothing new appears keeps this
    // independent of insertion order without needing the entries pre-sorted.
    for (let added = true; added;) {
      added = false
      for (const entry of all) {
        if (entry.parent_id && subtree.has(entry.parent_id) && !subtree.has(entry.id)) {
          subtree.add(entry.id)
          added = true
        }
      }
    }

    // Incoming connections live outside the subtree but are needed to render it.
    const needed = all.filter(
      (entry) =>
        subtree.has(entry.id) ||
        (entry.relation_type === 'connection' && entry.target_id && subtree.has(entry.target_id)),
    )

    return needed.sort(compareEntries).map((entry) => structuredClone(entry))
  }

  clear(): void {
    this.entries.clear()
  }

  private collect(
    predicate: (entry: Entry) => boolean,
    sorter: (a: Entry, b: Entry) => number = compareEntries,
  ): Entry[] {
    return [...this.entries.values()]
      .filter(predicate)
      .sort(sorter)
      .map((entry) => structuredClone(entry))
  }
}

export const entryRepository = new InMemoryEntryRepository()
