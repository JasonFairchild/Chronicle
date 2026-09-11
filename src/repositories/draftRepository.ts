import type { Draft } from '@/types/draft'

/**
 * The draft buffer. Unlike `EntryRepository` this one really does overwrite rows, because a live
 * session is working space rather than history — a distinction ENTRY_MODEL.md draws deliberately
 * so the append-only rule over entries stays absolute.
 *
 * Its own interface rather than a corner of the entry repository: drafts are keyed by session, are
 * mutable, and are deleted on sealing. Nothing they need overlaps with what an entry query does.
 */
export interface DraftRepository {
  /** Upsert. Called on every debounced flush, so it must be cheap and idempotent. */
  save(draft: Draft): Promise<Draft>
  getById(sessionId: string): Promise<Draft | null>
  /** Most recently touched first: the drafts list exists so none are stranded invisibly. */
  list(): Promise<Draft[]>
  /** Called after sealing, once the draft's contents already live in a committed entry. */
  delete(sessionId: string): Promise<void>
}
