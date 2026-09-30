import Dexie from 'dexie'
import type { AuthoringEvent, CreateEntryInput, Entry } from '@/types/entry'
import {
  toSnapshot,
  withEvents,
  type Draft,
  type DraftDocumentRole,
  type DraftSnapshot,
} from '@/types/draft'
import { resolveDatabase, type ChronicleDatabase, type StoredDraftEvent } from './chronicleDatabase'
import { DexieEntryRepository } from './dexieEntryRepository'
import { DraftConflictError, type DraftRepository, type PersistedEvents } from './draftRepository'

/**
 * Drafts on disk, not in memory. That is the whole reason a crash costs nothing: every scheduled
 * flush lands in the same local-first store the entries use, so a closed laptop loses at most the
 * few hundred milliseconds of typing since the last one.
 */
export class DexieDraftRepository implements DraftRepository {
  private db: ChronicleDatabase
  /** Writes a seal's entries on this same connection, so one transaction can span both. */
  private entries: DexieEntryRepository

  constructor(database: ChronicleDatabase | string = 'chronicle') {
    this.db = resolveDatabase(database)
    this.entries = new DexieEntryRepository(this.db)
  }

  async save(draft: Draft, persisted: PersistedEvents): Promise<void> {
    const newEvents = [
      ...eventRows(draft.session_id, 'entry', draft.entry.events, persisted.entry),
      ...(draft.kind === 'new_related'
        ? eventRows(draft.session_id, 'parent', draft.parent.events, persisted.parent)
        : []),
    ]

    // The snapshot row never carries events: they live in `draftEvents` from here on, appended
    // rather than rewritten, and reassembled by `getById`.
    const snapshot = toSnapshot(draft)

    // One transaction: a crash between the two writes must not leave events on disk that the
    // snapshot doesn't yet account for, or vice versa.
    await this.db.transaction('rw', this.db.drafts, this.db.draftEvents, async () => {
      // `put`, not `add`: overwriting is the point of this store, and it is why drafts are kept
      // out of the entries table rather than being a flag on it. The clone guards a narrower race
      // than crash recovery (that fidelity comes from the durable event log): Dexie holds this
      // object by reference until it reaches the real `IDBObjectStore.put()` a microtask or two
      // later, and cloning keeps a keystroke landing in that window from mutating an in-flight
      // write.
      await this.db.drafts.put(structuredClone(snapshot))
      if (newEvents.length === 0) return

      // `add`, not `put`: an event is appended once, and an index already taken means another tab
      // wrote this log since this one last did. Throwing aborts the snapshot write above too.
      try {
        await this.db.draftEvents.bulkAdd(structuredClone(newEvents))
      } catch (err) {
        throw err instanceof Dexie.BulkError ? new DraftConflictError() : err
      }
    })
  }

  async getById(sessionId: string): Promise<Draft | null> {
    const snapshot = await this.db.drafts.get(sessionId)
    if (!snapshot) return null

    return reassemble(snapshot, await this.eventsFor(sessionId))
  }

  async list(): Promise<DraftSnapshot[]> {
    const drafts = await this.db.drafts.orderBy('updated_at').reverse().toArray()
    // `updated_at` is millisecond-resolution, so two drafts flushed in the same tick would
    // otherwise come back in whatever order the index happened to hold them.
    //
    // No `draftEvents` query here — that's the whole point. The rows are snapshots already.
    return drafts.sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.session_id.localeCompare(a.session_id),
    )
  }

  async seal(sessionId: string, inputs: CreateEntryInput[]): Promise<Entry[]> {
    const { drafts, draftEvents, entries } = this.db

    // `createMany` opens its own transaction on `entries`, which joins this one. The draft goes
    // first, so an entry the write refuses rolls its deletion back too.
    return this.db.transaction('rw', [drafts, draftEvents, entries], async () => {
      await this.delete(sessionId)
      return this.entries.createMany(inputs)
    })
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.transaction('rw', this.db.drafts, this.db.draftEvents, async () => {
      await this.db.drafts.delete(sessionId)
      await this.db.draftEvents.where('session_id').equals(sessionId).delete()
    })
  }

  private async eventsFor(sessionId: string): Promise<StoredDraftEvent[]> {
    return this.db.draftEvents.where('session_id').equals(sessionId).toArray()
  }

  /** Closes this instance's connection without deleting the database. */
  close(): void {
    this.db.close()
  }
}

function eventRows(
  sessionId: string,
  document: DraftDocumentRole,
  events: AuthoringEvent[],
  persistedCount: number,
): StoredDraftEvent[] {
  return events.slice(persistedCount).map((event, i) => ({
    session_id: sessionId,
    document,
    index: persistedCount + i,
    event,
  }))
}

function reassemble(snapshot: DraftSnapshot, rows: StoredDraftEvent[]): Draft {
  const byDocument = (document: DraftDocumentRole) =>
    rows
      .filter((row) => row.document === document)
      .sort((a, b) => a.index - b.index)
      .map((row) => row.event)

  return withEvents(snapshot, { entry: byDocument('entry'), parent: byDocument('parent') })
}
