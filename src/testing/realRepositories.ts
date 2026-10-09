import {
  setDraftRepository,
  setEntryRepository,
  setMarkSetRepository,
  setMediaRepository,
} from '@/repositories'
import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { DexieMarkSetRepository } from '@/repositories/dexieMarkSetRepository'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import type { MarkSetRepository } from '@/repositories/markSetRepository'
import type { MediaRepository } from '@/repositories/mediaRepository'
import { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'

/**
 * Real, isolated storage for a test — a fresh Dexie database or OPFS directory per call, pointed at
 * by the composition root, exactly like production. Isolation comes from a unique name per call,
 * the same approach `dexieEntryRepository.browser.test.ts` and its siblings already use to prove
 * the adapters themselves.
 *
 * Setup and cleanup are global: `cypress/support/component.ts` and `src/testing/browserSetup.ts`
 * each call `freshRepositories()` in a `beforeEach` and `disposeTestRepositories()` in an
 * `afterEach`, so specs reach storage through `@/repositories` and never set it up themselves.
 */

let counter = 0
const disposers: Array<() => Promise<void>> = []

function uniqueName(label: string): string {
  return `chronicle-test-${label}-${Date.now()}-${counter++}`
}

/**
 * The one database entries and drafts share within a test, matching what `repositories/index.ts`
 * does in production. They must share it: sealing an anchor-mode draft is meant to commit a parent
 * revision and its related entry in one transaction, and a transaction cannot span two connections.
 * Two databases here would let such a test pass — or fail — for a reason production never sees.
 *
 * Opened on first use, so a spec needing only one of the two still opens only one connection, and
 * cleared by its own disposer so the next test starts from nothing.
 */
let database: ChronicleDatabase | null = null

function sharedDatabase(): ChronicleDatabase {
  if (database) return database

  const opened = new ChronicleDatabase(uniqueName('db'))
  database = opened
  disposers.push(async () => {
    database = null
    await opened.delete()
  })

  return opened
}

export function freshEntryRepository(): EntryRepository {
  const repository = new DexieEntryRepository(sharedDatabase())
  setEntryRepository(repository)
  return repository
}

export function freshDraftRepository(): DraftRepository {
  const repository = new DexieDraftRepository(sharedDatabase())
  setDraftRepository(repository)
  return repository
}

export function freshMarkSetRepository(): MarkSetRepository {
  const repository = new DexieMarkSetRepository(sharedDatabase())
  setMarkSetRepository(repository)
  return repository
}

export function freshMediaRepository(): MediaRepository {
  const repository = new OpfsMediaRepository(uniqueName('media'))
  setMediaRepository(repository)
  disposers.push(() => repository.dispose())
  return repository
}

/** Points every repository at fresh storage. Constructing opens nothing; first use does. */
export function freshRepositories(): void {
  freshEntryRepository()
  freshDraftRepository()
  freshMarkSetRepository()
  freshMediaRepository()
}

/** Test-only: disposes everything created since the last call. Safe to call even if nothing was. */
export async function disposeTestRepositories(): Promise<void> {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
}
