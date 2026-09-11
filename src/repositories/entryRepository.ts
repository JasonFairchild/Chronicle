import type { CreateEntryInput, Entry } from '@/types/entry'

export interface EntryRepository {
  create(input: CreateEntryInput): Promise<Entry>

  /**
   * Writes several entries as one unit: either all of them land or none do.
   *
   * This exists for exactly one shape, and it is not a convenience. Sealing an anchor-mode session
   * produces a parent revision carrying the new anchors and a child entry referencing them by id,
   * and a half-written pair is nonsense in both directions — a revision whose anchors no entry
   * explains, or a child pointing at ids nothing in the parent carries. Ids are still allocated in
   * array order, so the entries keep the order they were written in.
   */
  createMany(inputs: CreateEntryInput[]): Promise<Entry[]>

  getById(id: string): Promise<Entry | null>

  /**
   * Timeline roots: entries with no relation at all. Note this is `relation_type === null`, not
   * `parent_id === null`, so a stray parentless relation can never leak into the timeline.
   */
  listRootEntries(): Promise<Entry[]>

  /**
   * Direct children, **excluding revisions**. Excluding them is the default rather than a rule each
   * call site has to remember, because forgetting it once renders version snapshots as if they were
   * annotations.
   */
  listChildren(parentId: string): Promise<Entry[]>

  /** The version chain's revision entries, oldest first. */
  listRevisions(entryId: string): Promise<Entry[]>

  /** Connections touching this entry from either end. */
  listConnectionsFor(entryId: string): Promise<Entry[]>

  /**
   * Everything needed to reconstruct one entry: itself, its whole subtree, and any connection
   * pointing into that subtree from outside.
   *
   * Deliberately no `listAll`: nothing needs the whole table, and a detail view that reached for
   * one would load the entire database to render a single entry. Export or search can add a
   * scanning method when there is a real caller for it.
   */
  listDescendants(rootId: string): Promise<Entry[]>
}
