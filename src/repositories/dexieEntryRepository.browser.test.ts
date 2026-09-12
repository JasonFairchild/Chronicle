import { afterEach, describe, expect, it } from 'vitest'
import { ChronicleDatabase, type StoredEntry } from '@/repositories/chronicleDatabase'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { runEntryRepositoryContract } from '@/repositories/entryRepository.contract'
import { createEntryInput } from '@/types/entry'

// Real IndexedDB, via Playwright Chromium — Dexie has nothing to fall back to in node, which is
// why this adapter is only proven here rather than in the unit project. Each repository gets its
// own database name so tests never see one another's rows, and every one opened is deleted after
// its test so a run doesn't leave databases behind in the browser's storage.
let dbCounter = 0
const opened: DexieEntryRepository[] = []

function freshRepository(): DexieEntryRepository {
  const repository = new DexieEntryRepository(`chronicle-contract-${Date.now()}-${dbCounter++}`)
  opened.push(repository)
  return repository
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((repository) => repository.dispose()))
})

runEntryRepositoryContract('Dexie', () => freshRepository())

describe('DexieEntryRepository persistence', () => {
  it('keeps data when a new instance opens the same database', async () => {
    const databaseName = `chronicle-persistence-${Date.now()}`
    const beforeReload = new DexieEntryRepository(databaseName)
    const created = await beforeReload.create(
      createEntryInput({ content: 'Written before reload' }),
    )

    // A fresh instance against the same name, sharing no in-memory state with the first — the
    // closest an automated test gets to "close the tab and reopen the app." The first connection
    // is closed, not left dangling, the way a closed tab would actually release it.
    beforeReload.close()
    const afterReload = new DexieEntryRepository(databaseName)
    const fetched = await afterReload.getById(created.id)

    expect(fetched?.content).toBe('Written before reload')

    await afterReload.dispose()
  })

  it('keeps relations intact across a reload, not just the row that was fetched by id', async () => {
    const databaseName = `chronicle-persistence-relations-${Date.now()}`
    const beforeReload = new DexieEntryRepository(databaseName)
    const parent = await beforeReload.create(createEntryInput({ content: 'Root' }))
    await beforeReload.create(
      createEntryInput({ content: 'Note', parent_id: parent.id, relation_type: 'annotation' }),
    )

    beforeReload.close()
    const afterReload = new DexieEntryRepository(databaseName)
    const children = await afterReload.listChildren(parent.id)

    expect(children).toHaveLength(1)
    expect(children[0]?.content).toBe('Note')

    await afterReload.dispose()
  })

  it('reads a pre-redesign anchor row as having no anchors, not a broken one', async () => {
    const db = new ChronicleDatabase(`chronicle-legacy-anchors-${Date.now()}`)
    const repository = new DexieEntryRepository(db)
    opened.push(repository)

    const parent = await repository.create(createEntryInput({ content: 'The meeting went badly' }))
    // Bypasses `create()` on purpose: this is the offset-and-quote shape anchors used before they
    // moved into the parent's document (ENTRY_MODEL.md), and `CreateEntryInput` has no way to
    // express it any more. A row like this is exactly what's still sitting in a browser that used
    // Chronicle before the redesign.
    await db.entries.add({
      id: 'legacy-child',
      created_at: new Date().toISOString(),
      recorded_at: null,
      recorded_time_note: null,
      occurred_at: null,
      occurred_time_note: null,
      parent_id: parent.id,
      relation_type: 'annotation',
      target_id: null,
      title: null,
      content: 'Wrong lake',
      anchors: [
        { kind: 'strike', at: { from: 10, to: 20, base_version_id: null, quote: 'Lake Tahoe' } },
      ] as unknown as StoredEntry['anchors'],
      revision_mode: null,
      authoring_trace: null,
      media_refs: [],
      metadata: {},
      is_root: 0,
    })

    const [child] = await repository.listChildren(parent.id)

    expect(child?.anchors).toEqual([])
  })
})
