import type { CreateMarkSetInput, MarkSet } from '@/types/markSet'

/** Saved mark sets. Unlike `EntryRepository`, this one deletes: a set is a cache (`MarkSet`). */
export interface MarkSetRepository {
  create(input: CreateMarkSetInput): Promise<MarkSet>
  /** Oldest first. Whole sets, frames included: a set's row is read whole either way. */
  listForEntry(entryId: string): Promise<MarkSet[]>
  get(id: string): Promise<MarkSet | null>
  delete(id: string): Promise<void>
}
