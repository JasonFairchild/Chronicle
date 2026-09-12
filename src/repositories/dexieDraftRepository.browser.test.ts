import { afterEach, describe, expect, it } from 'vitest'
import { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import { runDraftRepositoryContract } from '@/repositories/draftRepository.contract'
import { emptyEntryDates } from '@/types/entry'

// Real IndexedDB, via Playwright Chromium, for the same reason the entry adapter is proven here:
// Dexie has nothing to fall back to in node. Each test gets its own database name, and every one
// opened is deleted afterwards so a run leaves nothing behind in the browser's storage.
let dbCounter = 0
const opened: DexieDraftRepository[] = []

function freshRepository(): DexieDraftRepository {
  const repository = new DexieDraftRepository(`chronicle-drafts-${Date.now()}-${dbCounter++}`)
  opened.push(repository)
  return repository
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((repository) => repository.dispose()))
})

runDraftRepositoryContract('Dexie', () => freshRepository())

describe('DexieDraftRepository persistence', () => {
  it('still holds an unsealed draft after the tab is closed and reopened', async () => {
    const databaseName = `chronicle-drafts-persistence-${Date.now()}`
    const beforeReload = new DexieDraftRepository(databaseName)
    await beforeReload.save({
      session_id: 'session-1',
      target: { kind: 'new_root' },
      started_at: '2026-09-05T10:00:00.000Z',
      updated_at: '2026-09-05T10:00:02.000Z',
      content: 'Never got round to finishing this',
      dates: emptyEntryDates(),
      anchor_ids: [],
      parent_content: null,
      steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'replace' } }],
      parent_steps: [],
      ticks: [],
    })

    // A fresh connection sharing no in-memory state with the first — the closest an automated
    // test gets to a crash mid-sentence.
    beforeReload.close()
    const afterReload = new DexieDraftRepository(databaseName)
    const recovered = await afterReload.getById('session-1')

    expect(recovered?.content).toBe('Never got round to finishing this')
    expect(recovered?.steps).toHaveLength(1)

    await afterReload.dispose()
  })
})
