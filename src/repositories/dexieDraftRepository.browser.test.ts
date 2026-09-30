import Dexie from 'dexie'
import { describe, expect, it, onTestFinished } from 'vitest'
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
    // By name, so a failing assertion can't leave it behind; Dexie closes open connections first.
    onTestFinished(() => Dexie.delete(databaseName))

    const beforeReload = new DexieDraftRepository(databaseName)
    await beforeReload.save(
      makeDraft('session-1', {
        entry: {
          content: 'Never got round to finishing this',
          events: [{ kind: 'edit', at: 1_000, steps: [{ stepType: 'replace' }] }],
        },
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
  })
})
