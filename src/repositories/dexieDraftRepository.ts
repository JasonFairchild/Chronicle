import type { Draft } from '@/types/draft'
import { resolveDatabase, type ChronicleDatabase } from './chronicleDatabase'
import type { DraftRepository } from './draftRepository'

/**
 * Drafts on disk, not in memory. That is the whole reason a crash costs nothing: every debounced
 * flush lands in the same local-first store the entries use, so a closed laptop loses at most the
 * few hundred milliseconds of typing since the last one.
 */
export class DexieDraftRepository implements DraftRepository {
  private db: ChronicleDatabase

  constructor(database: ChronicleDatabase | string = 'chronicle') {
    this.db = resolveDatabase(database)
  }

  async save(draft: Draft): Promise<Draft> {
    // `put`, not `add`: overwriting is the point of this store, and it is why drafts are kept
    // out of the entries table rather than being a flag on it.
    await this.db.drafts.put(structuredClone(draft))
    return structuredClone(draft)
  }

  async getById(sessionId: string): Promise<Draft | null> {
    return (await this.db.drafts.get(sessionId)) ?? null
  }

  async list(): Promise<Draft[]> {
    const drafts = await this.db.drafts.orderBy('updated_at').reverse().toArray()
    // `updated_at` is millisecond-resolution, so two drafts flushed in the same tick would
    // otherwise come back in whatever order the index happened to hold them.
    return drafts.sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.session_id.localeCompare(a.session_id),
    )
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.drafts.delete(sessionId)
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
