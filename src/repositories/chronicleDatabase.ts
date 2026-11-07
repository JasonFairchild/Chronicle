import Dexie, { type Table } from 'dexie'

import type { DraftDocumentRole, DraftSnapshot } from '@/types/draft'
import type { AuthoringEvent, Entry } from '@/types/entry'
import type { MarkSet } from '@/types/markSet'

/**
 * The row Dexie actually stores. `is_root` is a storage-only indexing helper and never appears
 * in the public `Entry` shape: IndexedDB cannot index a `null` property value, so a timeline root
 * (`relation_type === null`) has nothing `listRootEntries` could query directly. This numeric flag
 * is derived on write and stripped on every read.
 */
export interface StoredEntry extends Entry {
  is_root: 0 | 1
}

/**
 * One event of a draft's log, on its own row rather than inside the draft's snapshot row: the log
 * is the one unbounded part of a draft, so it is appended to rather than rewritten on every flush.
 * `document` distinguishes a `new_related` session's two logs, which otherwise share nothing but
 * `session_id`.
 */
export interface StoredDraftEvent {
  session_id: string
  document: DraftDocumentRole
  index: number
  event: AuthoringEvent
}

/**
 * One database holding every store the app persists to. Entries and drafts share a connection
 * because they share a lifecycle — sealing a draft writes an entry and deletes the draft — but they
 * stay separate tables, which is what keeps entries append-only while drafts rewrite themselves
 * constantly. Mark sets are a third table for the same reason: they may be deleted.
 */
export class ChronicleDatabase extends Dexie {
  entries!: Table<StoredEntry, string>
  drafts!: Table<DraftSnapshot, string>
  draftEvents!: Table<StoredDraftEvent, [string, DraftDocumentRole, number]>
  markSets!: Table<MarkSet, string>

  constructor(name = 'chronicle') {
    super(name)

    // Version 1, and only the current schema, until a release has data to keep: before then local
    // data is test data, cleared rather than migrated (CLAUDE.md), so the number never moves. Dexie
    // opens a browser installed at a higher number as it is, and patches in a table or index added
    // here; any other change needs local data cleared (TESTING.md).
    this.version(1).stores({
      // parent_id/target_id are never indexed for entries where they're null (roots have no
      // parent_id; only connections have a target_id) — that's correct, since every query for
      // those columns supplies a real id and a root or non-connection row would never match.
      entries:
        'id, parent_id, target_id, created_at, is_root, [parent_id+relation_type], [target_id+relation_type]',
      drafts: 'session_id, updated_at',
      // A `drafts` row is a snapshot, holding no events; they're reassembled from here on read.
      // `session_id` alone is indexed alongside the compound key so a delete or a full-log read
      // doesn't need `document` too.
      draftEvents: '[session_id+document+index], session_id',
      markSets: 'id, entry_id',
    })
  }
}
