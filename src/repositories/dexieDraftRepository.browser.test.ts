import { describe, expect, it } from 'vitest'

import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { runDraftRepositoryContract } from '@/repositories/draftRepository.contract'
import { makeDraft } from '@/testing/draftFixtures'

// Real IndexedDB, via Playwright Chromium, for the same reason the entry adapter is proven here.
// Drafts and entries share one connection, as the composition root has them, so a seal is one
// write.
const database = new ChronicleDatabase()
runDraftRepositoryContract('Dexie', () => ({
  drafts: new DexieDraftRepository(database),
  entries: new DexieEntryRepository(database),
}))

describe('DexieDraftRepository persistence', () => {
  it('still holds an unsealed draft after the tab is closed and reopened', async () => {
    const beforeReload = new ChronicleDatabase()
    await new DexieDraftRepository(beforeReload).save(
      makeDraft('session-1', {
        entry: {
          content: 'Never got round to finishing this',
          events: [{ kind: 'edit', at: 1_000, steps: [{ stepType: 'replace' }] }],
        },
      }),
    )

    // A fresh connection sharing no in-memory state with the first — the closest an automated
    // test gets to a crash mid-sentence.
    beforeReload.close()
    const recovered = await new DexieDraftRepository(new ChronicleDatabase()).getById('session-1')

    expect(recovered?.entry.content).toBe('Never got round to finishing this')
    expect(recovered?.entry.events).toHaveLength(1)
  })
})
