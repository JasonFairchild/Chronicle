import Dexie from 'dexie'

import {
  type Draft,
  type DraftDocumentRole,
  type DraftSnapshot,
  toSnapshot,
  withEvents,
} from '@/types/draft'
import type { AuthoringEvent, CreateEntryInput, Entry } from '@/types/entry'
import { newId } from '@/utils/id'

import { type ChronicleDatabase, resolveDatabase, type StoredDraftEvent } from './chronicleDatabase'
import { DexieEntryRepository } from './dexieEntryRepository'
import { assertFollows, type DraftRepository } from './draftRepository'

function reassemble(snapshot: DraftSnapshot, rows: StoredDraftEvent[]): Draft {
  const byDocument = (document: DraftDocumentRole) =>
    rows
      .filter((row) => row.document === document)
      .sort((a, b) => a.index - b.index)
      .map((row) => row.event)

  return withEvents(snapshot, { entry: byDocument('entry'), parent: byDocument('parent') })
}

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

  /** Rows for what `events` holds past the stored log, which is always where it starts. */
  private async tailRows(
    sessionId: string,
    document: DraftDocumentRole,
    events: AuthoringEvent[],
  ): Promise<StoredDraftEvent[]> {
    const stored = await this.db.draftEvents
      .where('[session_id+document+index]')
      .between([sessionId, document, Dexie.minKey], [sessionId, document, Dexie.maxKey])
      .count()
    return events
      .slice(stored)
      .map((event, i) => ({ session_id: sessionId, document, index: stored + i, event }))
  }

  async save(draft: Draft): Promise<string> {
    const { session_id: sessionId } = draft
    const writeId = newId()
    // The snapshot row never carries events: they live in `draftEvents` from here on, appended
    // rather than rewritten, and reassembled by `getById`.
    const snapshot = { ...toSnapshot(draft), write_id: writeId }

    // One transaction: a crash between the two writes must not leave events on disk that the
    // snapshot doesn't yet account for, or vice versa.
    await this.db.transaction('rw', this.db.drafts, this.db.draftEvents, async () => {
      assertFollows(await this.db.drafts.get(sessionId), draft.write_id)

      // `put`, not `add`: overwriting is the point of this store, and it is why drafts are kept
      // out of the entries table rather than being a flag on it. The clone guards a narrower race
      // than crash recovery (that fidelity comes from the durable event log): Dexie holds this
      // object by reference until it reaches the real `IDBObjectStore.put()` a microtask or two
      // later, and cloning keeps a keystroke landing in that window from mutating an in-flight
      // write.
      await this.db.drafts.put(structuredClone(snapshot))

      const newEvents = [
        ...(await this.tailRows(sessionId, 'entry', draft.entry.events)),
        ...(draft.kind === 'new_related'
          ? await this.tailRows(sessionId, 'parent', draft.parent.events)
          : []),
      ]
      // `add`, not `put`: a stored event is never written over.
      if (newEvents.length > 0) await this.db.draftEvents.bulkAdd(structuredClone(newEvents))
    })
    return writeId
  }

  private async eventsFor(sessionId: string): Promise<StoredDraftEvent[]> {
    return this.db.draftEvents.where('session_id').equals(sessionId).toArray()
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

  async seal(
    sessionId: string,
    inputs: CreateEntryInput[],
    follows: string | null,
  ): Promise<Entry[]> {
    const { drafts, draftEvents, entries } = this.db

    // `createMany` opens its own transaction on `entries`, which joins this one. The draft goes
    // first, so an entry the write refuses rolls its deletion back too.
    return this.db.transaction('rw', [drafts, draftEvents, entries], async () => {
      assertFollows(await drafts.get(sessionId), follows) // `delete` takes a row already gone.
      await this.delete(sessionId, follows)
      return this.entries.createMany(inputs)
    })
  }

  async delete(sessionId: string, follows: string | null): Promise<void> {
    await this.db.transaction('rw', this.db.drafts, this.db.draftEvents, async () => {
      const stored = await this.db.drafts.get(sessionId)
      if (stored) assertFollows(stored, follows)

      await this.db.drafts.delete(sessionId)
      await this.db.draftEvents.where('session_id').equals(sessionId).delete()
    })
  }

  /** Closes this instance's connection without deleting the database. */
  close(): void {
    this.db.close()
  }
}
