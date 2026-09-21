import type { CreateEntryInput, Entry } from '@/types/entry'

/**
 * How an adapter hands the validator a parent row. Only invoked for the one rule that needs one,
 * so a lookup is never paid for a create that cannot violate it.
 */
export type ParentLookup = (id: string) => Entry | undefined | Promise<Entry | undefined>

/**
 * The structural relation rules, written once so every adapter enforces exactly the same ones.
 * Each adapter reads a parent row differently — a Map lookup in memory, an indexed query in
 * Dexie — so the lookup is injected and this module stays pure and node-testable.
 *
 * Structure only: nothing here has an opinion about content, which is the editor's business.
 *
 * Deliberately unchecked: that `parent_id` names an entry that already exists. A child arriving
 * before its parent is a real state in a local-first app — an out-of-order import, a sync that
 * lands children first — and rejecting it would fail a write the model itself is fine with.
 */
export async function assertValidRelation(
  input: CreateEntryInput,
  loadParent: ParentLookup,
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

  if (input.relation_type === 'revision' && input.parent_id) {
    const parent = await loadParent(input.parent_id)
    // Revisions of revisions are meaningless: a version chain is linear and belongs to the entry
    // being revised, not to one of its snapshots.
    if (parent?.relation_type === 'revision') {
      throw new Error('A revision cannot revise another revision')
    }
  }
}
