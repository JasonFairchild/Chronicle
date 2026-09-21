import {
  compareEntries,
  newEntryId,
  newEntryTimestamp,
  type CreateEntryInput,
  type Entry,
} from '@/types/entry'
import { assertValidRelation } from '@/domain/entryValidation'
import { resolveDatabase, type ChronicleDatabase, type StoredEntry } from './chronicleDatabase'
import type { EntryRepository } from './entryRepository'

/**
 * SQLite WASM + OPFS is the preferred long-term adapter (CHRONICLE_PLAN.md); Dexie ships first
 * because it needs no cross-origin isolation headers and proves the same interface can be backed
 * by more than one storage engine. `entryRepository.contract.ts` is what makes that provable: both
 * adapters run the identical behavioral suite.
 */
export class DexieEntryRepository implements EntryRepository {
  private db: ChronicleDatabase

  constructor(database: ChronicleDatabase | string = 'chronicle') {
    this.db = resolveDatabase(database)
  }

  async create(input: CreateEntryInput): Promise<Entry> {
    const [entry] = await this.createMany([input])
    return entry!
  }

  async createMany(inputs: CreateEntryInput[]): Promise<Entry[]> {
    // One IndexedDB transaction: either every row commits or the whole write rolls back, which is
    // what an anchor-mode seal needs (see the interface doc) — a parent revision and the child
    // referencing its anchors must never land as a partial pair.
    return this.db.transaction('rw', this.db.entries, async () => {
      const staged: StoredEntry[] = []
      const loadParent = async (id: string) =>
        staged.find((entry) => entry.id === id) ?? (await this.db.entries.get(id))

      for (const input of inputs) {
        await assertValidRelation(input, loadParent)

        staged.push({
          id: newEntryId(),
          created_at: newEntryTimestamp(),
          ...input,
          is_root: input.relation_type === null ? 1 : 0,
        })
      }

      await this.db.entries.bulkAdd(staged)
      return staged.map(stripStorage)
    })
  }

  async getById(id: string): Promise<Entry | null> {
    const entry = await this.db.entries.get(id)
    return entry ? stripStorage(entry) : null
  }

  async listRootEntries(): Promise<Entry[]> {
    const rows = await this.db.entries.where('is_root').equals(1).toArray()
    return rows.sort((a, b) => compareEntries(b, a)).map(stripStorage)
  }

  async listChildren(parentId: string): Promise<Entry[]> {
    const rows = await this.db.entries.where('parent_id').equals(parentId).toArray()
    return rows
      .filter((entry) => entry.relation_type !== 'revision')
      .sort(compareEntries)
      .map(stripStorage)
  }

  async listRevisions(entryId: string): Promise<Entry[]> {
    const rows = await this.db.entries
      .where('[parent_id+relation_type]')
      .equals([entryId, 'revision'])
      .toArray()
    return rows.sort(compareEntries).map(stripStorage)
  }

  async listConnectionsFor(entryId: string): Promise<Entry[]> {
    const [outgoing, incoming] = await Promise.all([
      this.db.entries.where('[parent_id+relation_type]').equals([entryId, 'connection']).toArray(),
      this.db.entries.where('[target_id+relation_type]').equals([entryId, 'connection']).toArray(),
    ])

    return dedupeById([...outgoing, ...incoming])
      .sort(compareEntries)
      .map(stripStorage)
  }

  async listDescendants(rootId: string): Promise<Entry[]> {
    const root = await this.db.entries.get(rootId)
    if (!root) return []

    const subtree = new Map<string, StoredEntry>([[rootId, root]])
    let frontier = [rootId]

    // Indexed breadth-first expansion rather than the repeated full-table scan the in-memory
    // adapter uses: each level here is one indexed query instead of a scan-until-fixpoint loop.
    //
    // Two edges grow the frontier, not one: parent_id children, and incoming connections (an
    // entry outside the subtree whose target_id points into it). Both run every iteration, or a
    // connection's own children — annotations on it, its own revisions — are found once as a
    // one-level graft and never explored further themselves.
    while (frontier.length > 0) {
      const [children, incoming] = await Promise.all([
        this.db.entries.where('parent_id').anyOf(frontier).toArray(),
        this.db.entries
          .where('[target_id+relation_type]')
          .anyOf(frontier.map((id): [string, 'connection'] => [id, 'connection']))
          .toArray(),
      ])

      frontier = []
      for (const row of [...children, ...incoming]) {
        if (!subtree.has(row.id)) {
          subtree.set(row.id, row)
          frontier.push(row.id)
        }
      }
    }

    return [...subtree.values()].sort(compareEntries).map(stripStorage)
  }

  /** Closes this instance's connection without deleting the database. */
  close(): void {
    this.db.close()
  }

  /** Test-only: deletes the underlying IndexedDB database and closes this instance. */
  async dispose(): Promise<void> {
    await this.db.delete()
  }
}

/** Drops the storage-only indexing flag. */
function stripStorage(entry: StoredEntry): Entry {
  const { is_root: _is_root, ...rest } = entry
  return rest
}

function dedupeById(entries: StoredEntry[]): StoredEntry[] {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()]
}
