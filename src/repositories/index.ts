import { ChronicleDatabase } from './chronicleDatabase'
import { DexieDraftRepository } from './dexieDraftRepository'
import { DexieEntryRepository } from './dexieEntryRepository'
import { DexieMarkSetRepository } from './dexieMarkSetRepository'
import type { DraftRepository } from './draftRepository'
import type { EntryRepository } from './entryRepository'
import type { MarkSetRepository } from './markSetRepository'
import type { MediaRepository } from './mediaRepository'
import { OpfsMediaRepository } from './opfsMediaRepository'

// The one place the app decides which storage backends implement its repository interfaces. The
// stores and `useMedia` import from here, and nothing else in source may (eslint.config.js); none
// names a concrete adapter, so switching backends (Dexie now, SQLite WASM + OPFS later;
// CHRONICLE_PLAN.md) means changing the lines below and nothing else. The `.contract.ts` suites are
// what make that swap trustworthy: a new adapter must pass what the current one passes.

/** One connection, since sealing touches entries and drafts in the same breath. */
const database = new ChronicleDatabase()

export const entryRepository: EntryRepository = new DexieEntryRepository(database)
export const draftRepository: DraftRepository = new DexieDraftRepository(database)
export const markSetRepository: MarkSetRepository = new DexieMarkSetRepository(database)
export const mediaRepository: MediaRepository = new OpfsMediaRepository()
