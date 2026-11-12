import { describe, expect, it } from 'vitest'

import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { runEntryRepositoryContract } from '@/repositories/entryRepository.contract'
import { seedEntry } from '@/testing/seedEntry'

// Real IndexedDB, via Playwright Chromium. Not in node too: on fake-indexeddb it would prove the
// fake rather than the adapter. Its own instance, not the composition root's, so this still proves
// Dexie once the root wires in another backend.
const database = new ChronicleDatabase()
runEntryRepositoryContract('Dexie', () => new DexieEntryRepository(database))

describe('DexieEntryRepository persistence', () => {
  it('keeps data when a new instance opens the same database', async () => {
    const beforeReload = new ChronicleDatabase()
    const created = await seedEntry(
      { content: 'Written before reload' },
      new DexieEntryRepository(beforeReload),
    )

    // A fresh connection, sharing no in-memory state with the first — the closest an automated
    // test gets to "close the tab and reopen the app." The first is closed, as a closed tab would.
    beforeReload.close()
    const fetched = await new DexieEntryRepository(new ChronicleDatabase()).getById(created.id)

    expect(fetched?.content).toBe('Written before reload')
  })

  it('keeps relations intact across a reload, not just the row that was fetched by id', async () => {
    const beforeReload = new ChronicleDatabase()
    const entries = new DexieEntryRepository(beforeReload)
    const parent = await seedEntry({ content: 'Root' }, entries)
    await seedEntry({ content: 'Note', parent_id: parent.id, relation_type: 'annotation' }, entries)

    beforeReload.close()
    const descendants = await new DexieEntryRepository(new ChronicleDatabase()).listDescendants(
      parent.id,
    )

    expect(descendants.map((entry) => entry.content)).toEqual(['Root', 'Note'])
  })
})
