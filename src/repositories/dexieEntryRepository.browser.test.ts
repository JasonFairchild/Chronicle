import Dexie from 'dexie'
import { describe, expect, it, onTestFinished } from 'vitest'

import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { runEntryRepositoryContract } from '@/repositories/entryRepository.contract'
import { freshEntryRepository } from '@/testing/realRepositories'
import { createEntryInput } from '@/types/entry'

// Real IndexedDB, via Playwright Chromium — Dexie has nothing to fall back to in node, which is
// why this adapter is only proven here rather than in the unit project. Each test gets its own
// database, which `realRepositories.ts` deletes after.
runEntryRepositoryContract('Dexie', () => freshEntryRepository())

describe('DexieEntryRepository persistence', () => {
  it('keeps data when a new instance opens the same database', async () => {
    const databaseName = `chronicle-persistence-${Date.now()}`
    // By name, so a failing assertion can't leave it behind; Dexie closes open connections first.
    onTestFinished(() => Dexie.delete(databaseName))

    const beforeReload = new ChronicleDatabase(databaseName)
    const created = await new DexieEntryRepository(beforeReload).create(
      createEntryInput({ content: 'Written before reload' }),
    )

    // A fresh connection against the same name, sharing no in-memory state with the first — the
    // closest an automated test gets to "close the tab and reopen the app." The first connection
    // is closed, not left dangling, the way a closed tab would actually release it.
    beforeReload.close()
    const afterReload = new DexieEntryRepository(new ChronicleDatabase(databaseName))
    const fetched = await afterReload.getById(created.id)

    expect(fetched?.content).toBe('Written before reload')
  })

  it('keeps relations intact across a reload, not just the row that was fetched by id', async () => {
    const databaseName = `chronicle-persistence-relations-${Date.now()}`
    onTestFinished(() => Dexie.delete(databaseName))

    const beforeReload = new ChronicleDatabase(databaseName)
    const entries = new DexieEntryRepository(beforeReload)
    const parent = await entries.create(createEntryInput({ content: 'Root' }))
    await entries.create(
      createEntryInput({ content: 'Note', parent_id: parent.id, relation_type: 'annotation' }),
    )

    beforeReload.close()
    const afterReload = new DexieEntryRepository(new ChronicleDatabase(databaseName))
    const children = await afterReload.listChildren(parent.id)

    expect(children).toHaveLength(1)
    expect(children[0]?.content).toBe('Note')
  })
})
