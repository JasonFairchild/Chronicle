import type { Draft, DraftSummary } from '@/types/draft'

/**
 * How much of a session's event logs the store already holds, so a save appends only the tail.
 * `parent` is meaningless (and ignored) when the draft has no `parent` document.
 */
export interface PersistedEvents {
  child: number
  parent: number
}

/**
 * The draft buffer. Unlike `EntryRepository` this one really does overwrite rows, because a live
 * session is working space rather than history — a distinction ENTRY_MODEL.md draws deliberately
 * so the append-only rule over entries stays absolute.
 *
 * Its own interface rather than a corner of the entry repository: drafts are keyed by session, are
 * mutable, and are deleted on sealing. Nothing they need overlaps with what an entry query does.
 */
export interface DraftRepository {
  /**
   * Upsert the snapshot and append whatever events `persisted` says aren't stored yet. Called on
   * every debounced flush, so it must be cheap and idempotent — the event log is the one unbounded
   * part of a draft, which is why it is appended rather than rewritten wholesale.
   */
  save(draft: Draft, persisted: PersistedEvents): Promise<void>
  getById(sessionId: string): Promise<Draft | null>
  /**
   * Most recently touched first: the drafts list exists so none are stranded invisibly. Summaries,
   * not whole drafts — the list renders a preview line per session, not its authoring history.
   */
  list(): Promise<DraftSummary[]>
  /** Called after sealing, once the draft's contents already live in a committed entry. */
  delete(sessionId: string): Promise<void>
}
