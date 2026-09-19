import Dexie, { type Table } from 'dexie'
import type { Draft } from '@/types/draft'
import type { AuthoringStep, Entry } from '@/types/entry'

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
 * One step of a draft's step chain, on its own row rather than inside the draft's own row — see
 * `ChronicleDatabase`'s docblock. `document` distinguishes a `new_child` session's two chains
 * (child and parent), which otherwise share nothing but `session_id`.
 */
export interface StoredDraftStep extends AuthoringStep {
  session_id: string
  document: 'child' | 'parent'
  index: number
}

/**
 * One database holding both stores the app persists to. They share a connection because they share
 * a lifecycle — sealing a draft writes an entry and deletes the draft — but they stay separate
 * tables, which is what keeps entries append-only while drafts rewrite themselves constantly.
 *
 * Schema versions are additive and never edited in place. Version 1 shipped with entries alone, so
 * a browser that already holds one upgrades to version 2 rather than finding version 1 changed
 * underneath it, which Dexie would reject.
 */
export class ChronicleDatabase extends Dexie {
  entries!: Table<StoredEntry, string>
  drafts!: Table<Draft, string>
  draftSteps!: Table<StoredDraftStep, [string, 'child' | 'parent', number]>

  constructor(name = 'chronicle') {
    super(name)

    // parent_id/target_id are never indexed for entries where they're null (roots have no
    // parent_id; only connections have a target_id) — that's correct, since every query for
    // those columns supplies a real id and a root or non-connection row would never match anyway.
    this.version(1).stores({
      entries:
        'id, parent_id, target_id, created_at, is_root, [parent_id+relation_type], [target_id+relation_type]',
    })

    this.version(2).stores({
      drafts: 'session_id, updated_at',
    })

    // `drafts` rows carry no steps once this ships — the row's `child.steps`/`parent.steps` are
    // always stored empty and reassembled from here on read. `session_id` alone is indexed
    // alongside the compound key so a delete or a full-chain read doesn't need `document` too.
    this.version(3).stores({
      draftSteps: '[session_id+document+index], session_id',
    })
  }
}

/** Accepts either a database name or an already-open connection, so callers can share one. */
export function resolveDatabase(database: ChronicleDatabase | string): ChronicleDatabase {
  return typeof database === 'string' ? new ChronicleDatabase(database) : database
}
