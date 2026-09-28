import { afterEach, describe, expect, it } from 'vitest'
import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import {
  runDraftRepositoryContract,
  type DraftStorage,
} from '@/repositories/draftRepository.contract'
import { makeDraft } from '@/testing/draftFixtures'

// Real IndexedDB, via Playwright Chromium, for the same reason the entry adapter is proven here:
// Dexie has nothing to fall back to in node. Each test gets its own database name, and every one
// opened is deleted afterwards so a run leaves nothing behind in the browser's storage.
let dbCounter = 0
const opened: DexieDraftRepository[] = []

/** Drafts and entries on one database, as the composition root has them, so a seal is one write. */
function freshStorage(): DraftStorage {
  const database = new ChronicleDatabase(`chronicle-drafts-${Date.now()}-${dbCounter++}`)
  const drafts = new DexieDraftRepository(database)
  opened.push(drafts)
  return { drafts, entries: new DexieEntryRepository(database) }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((repository) => repository.dispose()))
})

runDraftRepositoryContract('Dexie', () => freshStorage())

describe('DexieDraftRepository persistence', () => {
  it('still holds an unsealed draft after the tab is closed and reopened', async () => {
    const databaseName = `chronicle-drafts-persistence-${Date.now()}`
    const beforeReload = new DexieDraftRepository(databaseName)
    await beforeReload.save(
      makeDraft('session-1', {
        content: 'Never got round to finishing this',
        events: [{ kind: 'edit', at: 1_000, steps: [{ stepType: 'replace' }] }],
      }),
      { entry: 0, parent: 0 },
    )

    // A fresh connection sharing no in-memory state with the first — the closest an automated
    // test gets to a crash mid-sentence.
    beforeReload.close()
    const afterReload = new DexieDraftRepository(databaseName)
    const recovered = await afterReload.getById('session-1')

    expect(recovered?.entry.content).toBe('Never got round to finishing this')
    expect(recovered?.entry.events).toHaveLength(1)

    await afterReload.dispose()
  })
})
