import { describe, expect, it, onTestFinished } from 'vitest'

import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import { runDraftRepositoryContract } from '@/repositories/draftRepository.contract'
import { makeDraft } from '@/testing/draftFixtures'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'

// Real IndexedDB, via Playwright Chromium, for the same reason the entry adapter is proven here:
// Dexie has nothing to fall back to in node. Drafts and entries share one database per test, as
// the composition root has them, so a seal is one write; `realRepositories.ts` deletes it after.
runDraftRepositoryContract('Dexie', () => ({
  drafts: freshDraftRepository(),
  entries: freshEntryRepository(),
}))

describe('DexieDraftRepository persistence', () => {
  it('still holds an unsealed draft after the tab is closed and reopened', async () => {
    const databaseName = `chronicle-drafts-persistence-${Date.now()}`
    const beforeReload = new ChronicleDatabase(databaseName)
    const afterReload = new ChronicleDatabase(databaseName) // Opens on first use, below.
    // Through the connection left open, which a delete closes first. Registered before any
    // assertion, so a failing one can't leave the database behind.
    onTestFinished(() => afterReload.delete())

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
    const recovered = await new DexieDraftRepository(afterReload).getById('session-1')

    expect(recovered?.entry.content).toBe('Never got round to finishing this')
    expect(recovered?.entry.events).toHaveLength(1)
  })
})
