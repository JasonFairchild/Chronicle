import { entryRepository } from '@/repositories'
import type { EntryRepository } from '@/repositories/entryRepository'
import { createEntryInput, type Entry } from '@/types/entry'

/**
 * An entry already on record, written through `createMany` as the app writes. `repository` defaults
 * to the composition root's, read at call time.
 */
export async function seedEntry(
  input: Parameters<typeof createEntryInput>[0],
  repository: EntryRepository = entryRepository,
): Promise<Entry> {
  const [entry] = await repository.createMany([createEntryInput(input)])
  return entry!
}
