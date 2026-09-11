import { setDraftRepository, setEntryRepository, setMediaRepository } from '@/repositories'
import { ChronicleDatabase } from '@/repositories/chronicleDatabase'
import { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'

/**
 * Real, isolated storage for a component/view test — a fresh Dexie database or OPFS directory per
 * call, pointed at by the composition root, exactly like production. Isolation comes from a unique
 * name per call, the same approach `dexieEntryRepository.browser.test.ts` and its siblings already
 * use to prove the adapters themselves. Call only the repositories a given spec actually needs —
 * this does not decide that for you.
 *
 * Cleanup is global rather than per-file: `cypress/support/component.ts` and
 * `src/testing/browserSetup.ts` each call `disposeTestRepositories()` in one `afterEach`, so specs
 * that never call any `freshXRepository()` pay nothing and need no cleanup of their own.
 */

let counter = 0
const disposers: Array<() => Promise<void>> = []

function uniqueName(label: string): string {
  return `chronicle-test-${label}-${Date.now()}-${counter++}`
}

/**
 * The one database entries and drafts share within a test, matching what `repositories/index.ts`
 * does in production. They must share it: sealing an anchor-mode draft is meant to commit a parent
 * revision and its child in a single transaction, and a transaction cannot span two connections.
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

export function freshEntryRepository(): DexieEntryRepository {
  const repository = new DexieEntryRepository(sharedDatabase())
  setEntryRepository(repository)
  return repository
}

export function freshDraftRepository(): DexieDraftRepository {
  const repository = new DexieDraftRepository(sharedDatabase())
  setDraftRepository(repository)
  return repository
}

export function freshMediaRepository(): OpfsMediaRepository {
  const repository = new OpfsMediaRepository(uniqueName('media'))
  setMediaRepository(repository)
  disposers.push(() => repository.dispose())
  return repository
}

/** Test-only: disposes everything created since the last call. Safe to call even if nothing was. */
export async function disposeTestRepositories(): Promise<void> {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
}
