import type { Draft, DraftDocumentRole, DraftSnapshot } from '@/types/draft'
import type { CreateEntryInput, Entry } from '@/types/entry'

/**
 * How much of each of a session's event logs the store already holds, so a save appends only the
 * tail. `parent` is meaningless (and ignored) when the draft has no `parent` document.
 */
export type PersistedEvents = Record<DraftDocumentRole, number>

/**
 * A save that would append events over ones already stored: another tab wrote this draft since
 * this one last read or wrote it. Refused whole, since interleaving two tabs' events would leave a
 * log that replays to neither's document.
 */
export class DraftConflictError extends Error {
  constructor() {
    super('This draft was changed in another tab')
    this.name = 'DraftConflictError'
  }
}

/**
 * The draft buffer. Unlike `EntryRepository` this one really does overwrite rows, because a live
 * session is working space rather than history — a distinction AUTHORING.md draws deliberately
 * so the append-only rule over entries stays absolute.
 *
 * Its own interface rather than a corner of the entry repository: drafts are keyed by session, are
 * mutable, and are deleted on sealing. Nothing they need overlaps with what an entry query does.
 */
export interface DraftRepository {
  /**
   * Upsert the snapshot and append whatever events `persisted` says aren't stored yet. Called on
   * every scheduled flush, so it must be cheap — the event log is the one unbounded part of a
   * draft, which is why it is appended rather than rewritten wholesale. Throws
   * `DraftConflictError`, writing nothing, if an event it appends is already stored.
   */
  save(draft: Draft, persisted: PersistedEvents): Promise<void>
  getById(sessionId: string): Promise<Draft | null>
  /**
   * Most recently touched first: the drafts list exists so none are stranded invisibly. Snapshots,
   * not whole drafts — the list renders a preview line per session, not its authoring history.
   */
  list(): Promise<DraftSnapshot[]>
  /**
   * Writes the entries a draft seals into and removes the draft, as one unit. Two writes could
   * leave a draft whose entries already exist — after a crash between them, or a delete that
   * failed — and saving it again would duplicate them for good. A refused write, such as a stale
   * revision, leaves the draft exactly as it was. Returns the entries in `inputs` order.
   */
  seal(sessionId: string, inputs: CreateEntryInput[]): Promise<Entry[]>
  /** Removes a draft without sealing it: discarding it, or emptying it of everything written. */
  delete(sessionId: string): Promise<void>
}
