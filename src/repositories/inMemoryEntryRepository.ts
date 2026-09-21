import {
  compareEntries,
  newEntryId,
  newEntryTimestamp,
  type CreateEntryInput,
  type Entry,
} from '@/types/entry'
import { assertValidRelation } from '@/domain/entryValidation'
import type { EntryRepository } from './entryRepository'

/**
 * The node-friendly adapter, for unit tests and anywhere IndexedDB doesn't exist. Proven against
 * the same `entryRepository.contract.ts` suite as the Dexie one, so a test written here describes
 * behavior the persistent adapter actually has.
 */
export class InMemoryEntryRepository implements EntryRepository {
  private entries = new Map<string, Entry>()

  async create(input: CreateEntryInput): Promise<Entry> {
    const [entry] = await this.createMany([input])
    return entry!
  }

  async createMany(inputs: CreateEntryInput[]): Promise<Entry[]> {
    // Validated and built against a lookup that sees this batch's own earlier entries, but nothing
    // is committed to the real map until every input has passed — an all-or-nothing write.
    const staged = new Map<string, Entry>()
    const loadParent = (id: string) => staged.get(id) ?? this.entries.get(id)

    for (const input of inputs) {
      await assertValidRelation(input, loadParent)

      const entry: Entry = {
        id: newEntryId(),
        created_at: newEntryTimestamp(),
        // Cloned on the way in as well as out. A plain spread is shallow, so `anchors`,
        // `media_refs`, and `metadata` would stay shared with the caller's object and mutating an
        // input after saving would quietly rewrite stored history.
        ...structuredClone(input),
      }
      staged.set(entry.id, entry)
    }

    for (const entry of staged.values()) this.entries.set(entry.id, entry)
    return [...staged.values()].map((entry) => structuredClone(entry))
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

    // Two edges grow the subtree, not one: parent_id containment, and an incoming connection (an
    // entry outside it whose target_id points in). Both run every pass, or a connection's own
    // children — annotations on it, its own revisions — are never picked up themselves. Repeating
    // until nothing new appears keeps this independent of insertion order and of which edge fires
    // first for a given entry.
    for (let added = true; added;) {
      added = false
      for (const entry of all) {
        if (subtree.has(entry.id)) continue

        const isChild = entry.parent_id !== null && subtree.has(entry.parent_id)
        const isIncomingConnection =
          entry.relation_type === 'connection' &&
          entry.target_id !== null &&
          subtree.has(entry.target_id)

        if (isChild || isIncomingConnection) {
          subtree.add(entry.id)
          added = true
        }
      }
    }

    return all
      .filter((entry) => subtree.has(entry.id))
      .sort(compareEntries)
      .map((entry) => structuredClone(entry))
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
