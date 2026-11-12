// Registered as the `unit` project's `setupFiles` entry in vitest.config.ts, as `browserSetup.ts`
// is the browser's.

// First: Dexie reads the global `indexedDB` when its module loads, which `testStorage` does.
import 'fake-indexeddb/auto'

import { afterEach, beforeEach } from 'vitest'

import { beginTest, endTest } from '@/testing/testStorage'

beforeEach(beginTest)
afterEach(endTest)
