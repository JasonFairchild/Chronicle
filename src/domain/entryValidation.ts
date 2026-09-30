import { compareEntries, type CreateEntryInput, type Entry } from '@/types/entry'

/**
 * How an adapter hands the validator what it reads. Each is invoked only for a revision, the one
 * kind of write that needs them, so a lookup is never paid for a create that cannot violate a rule.
 */
export interface RelationLookups {
  loadParent: (id: string) => Entry | undefined | Promise<Entry | undefined>
  /** The id of the row an entry's latest version came from, as `latestVersionOf` answers it. */
  latestVersionId: (entryId: string) => string | Promise<string>
}

/**
 * A revision written against a version that is no longer its entry's latest. Sealing it would
 * branch the version chain, silently undoing whatever the newer version changed.
 */
export class StaleVersionError extends Error {
  constructor() {
    super('The revision’s base version is no longer its entry’s latest')
    this.name = 'StaleVersionError'
  }
}

/** The id of the row an entry's latest version came from: its newest revision's, or its own. */
export function latestVersionOf(entryId: string, revisions: Entry[]): string {
  const sorted = [...revisions].sort(compareEntries)
  return sorted[sorted.length - 1]?.id ?? entryId
}

/**
 * The structural relation rules, written once so every adapter enforces exactly the same ones.
 * Each adapter reads rows differently — a Map lookup in memory, an indexed query in Dexie — so the
 * lookups are injected and this module stays pure and node-testable. An adapter runs this inside
 * its write, so what a lookup reads can't change before the write lands.
 *
 * Structure only: nothing here has an opinion about content, which is the editor's business.
 *
 * Deliberately unchecked: that `parent_id` names an entry that already exists. A child arriving
 * before its parent is a real state in a local-first app — an out-of-order import, a sync that
 * lands children first — and rejecting it would fail a write the model itself is fine with.
 */
export async function assertValidRelation(
  input: CreateEntryInput,
  lookups: RelationLookups,
): Promise<void> {
  if (input.relation_type !== null && !input.parent_id) {
    throw new Error(`A ${input.relation_type} entry requires a parent_id`)
  }

  if (input.relation_type === 'connection' && !input.target_id) {
    throw new Error('A connection entry requires a target_id')
  }

  if (input.relation_type === 'connection' && input.target_id === input.parent_id) {
    throw new Error('A connection needs two different entries')
  }

  if (input.relation_type !== 'connection' && input.target_id) {
    throw new Error('Only connection entries may set a target_id')
  }

  if (input.relation_type !== 'revision' && input.base_version_id) {
    throw new Error('Only revisions may set a base_version_id')
  }

  if (input.relation_type === 'revision' && input.parent_id) {
    const parent = await lookups.loadParent(input.parent_id)
    // Revisions of revisions are meaningless: a version chain is linear and belongs to the entry
    // being revised, not to one of its snapshots.
    if (parent?.relation_type === 'revision') {
      throw new Error('A revision cannot revise another revision')
    }

    // Naming the version it replaced is what keeps the chain a single line: each version's
    // predecessor is the one it was written against, not merely the one sealed before it.
    if (!input.base_version_id) {
      throw new Error('A revision must name the version it replaces')
    }
    if (input.base_version_id !== (await lookups.latestVersionId(input.parent_id))) {
      throw new StaleVersionError()
    }
  }
}
