// Registered as the `unit` project's `setupFiles` entry in vitest.config.ts, as `browserSetup.ts`
// is the browser's. Every test starts on fresh storage through the Dexie adapters the app runs, on
// fake-indexeddb. Not media: its disposer needs OPFS, and no node spec stores media.

// First: Dexie reads the global `indexedDB` when its module loads, which `realRepositories` does.
import 'fake-indexeddb/auto'

import { afterEach, beforeEach } from 'vitest'

// By alias, as specs import it: a relative path loads a second copy, with its own database.
import {
  disposeTestRepositories,
  freshDraftRepository,
  freshEntryRepository,
  freshMarkSetRepository,
} from '@/testing/realRepositories'

beforeEach(() => {
  freshEntryRepository()
  freshDraftRepository()
  freshMarkSetRepository()
})

// Nothing to settle first, unlike the browser's: no component is mounted, and each spec awaits
// what it starts.
afterEach(async () => {
  await disposeTestRepositories()
})
