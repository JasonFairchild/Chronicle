/**
 * Blob storage for the bytes an entry's document points at.
 *
 * Images live here rather than in the entry row for two reasons. Entries are immutable and get
 * copied forward by every revision, so inlining a photo would duplicate megabytes per edit. And a
 * document referring to a blob by id is what lets `media_refs` be derived from the document instead
 * of maintained alongside it, so a removed attachment leaves a dangling id rather than a broken
 * data URL.
 */
export interface MediaRepository {
  /** Stores the bytes and returns the id the document will refer to. */
  put(blob: Blob): Promise<string>
  get(id: string): Promise<Blob | null>
}
