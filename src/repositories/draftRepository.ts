import type { Draft, DraftSnapshot } from '@/types/draft'
import type { CreateEntryInput, Entry } from '@/types/entry'

/**
 * A write to a draft that another tab has written, sealed or discarded since this one last read or
 * wrote it: the write it follows isn't the stored row's `write_id`. Refused whole, writing nothing.
 */
export class DraftConflictError extends Error {
  constructor() {
    super('This draft was changed in another tab')
    this.name = 'DraftConflictError'
  }
}

/** Refuses a write unless `stored` is the row `follows` names; null names none. */
export function assertFollows(stored: DraftSnapshot | undefined, follows: string | null): void {
  if ((stored?.write_id ?? null) !== follows) throw new DraftConflictError()
}

/**
 * The draft buffer. Unlike `EntryRepository` this one really does overwrite rows, because a live
 * session is working space rather than history — a distinction AUTHORING.md draws deliberately
 * so the append-only rule over entries stays absolute.
 *
 * Its own interface rather than a corner of the entry repository: drafts are keyed by session, are
 * mutable, and are deleted on sealing. Nothing they need overlaps with what an entry query does.
 *
 * Every write names the stored write it follows: null for none. One that names any other throws
 * `DraftConflictError`, checked in the write's own transaction.
 */
export interface DraftRepository {
  /**
   * Upserts the snapshot as a new write following `draft.write_id`, and returns the new write's
   * id. Called on every scheduled flush, so it must be cheap — the event log is the one unbounded
   * part of a draft, so only its tail is appended: with the write it follows confirmed, what's
   * stored is the start of what `draft` holds.
   */
  save(draft: Draft): Promise<string>
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
   * revision, leaves the draft exactly as it was, and a draft already gone is refused, so its
   * entries are never written twice. Returns the entries in `inputs` order.
   */
  seal(sessionId: string, inputs: CreateEntryInput[], follows: string | null): Promise<Entry[]>
  /**
   * Removes a draft without sealing it: discarding it, or emptying it of everything written. One
   * already gone is no conflict, since that is the state asked for.
   */
  delete(sessionId: string, follows: string | null): Promise<void>
}
