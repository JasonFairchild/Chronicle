import { setDraftRepository, setEntryRepository, setMediaRepository } from '@/repositories'
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

export function freshEntryRepository(): DexieEntryRepository {
  const repository = new DexieEntryRepository(uniqueName('entries'))
  setEntryRepository(repository)
  disposers.push(() => repository.dispose())
  return repository
}

export function freshDraftRepository(): DexieDraftRepository {
  const repository = new DexieDraftRepository(uniqueName('drafts'))
  setDraftRepository(repository)
  disposers.push(() => repository.dispose())
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
