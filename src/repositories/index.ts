import { ChronicleDatabase } from './chronicleDatabase'
import { DexieDraftRepository } from './dexieDraftRepository'
import { DexieEntryRepository } from './dexieEntryRepository'
import type { DraftRepository } from './draftRepository'
import type { EntryRepository } from './entryRepository'
import type { MediaRepository } from './mediaRepository'
import { OpfsMediaRepository } from './opfsMediaRepository'

/**
 * The one place the app decides which storage backends implement its repository interfaces. Every
 * other module — the stores, the views, the domain layer — imports from here and never names a
 * concrete adapter, so switching backends (Dexie now, SQLite WASM + OPFS later; CHRONICLE_PLAN.md)
 * means changing the lines below and nothing else. The `.contract.ts` suites are what make that
 * swap trustworthy: every adapter runs the same behavioral suite.
 *
 * `let`, not `const`: ES module bindings are live, so a component test can call the setters to
 * point the whole app at isolated instances before mounting, and every module that imported one of
 * these — including the stores, whose closures captured the binding, not a snapshot of its value —
 * sees the swap.
 */

/** Entries and drafts share one connection because sealing touches both in the same breath. */
const database = new ChronicleDatabase('chronicle')

export let entryRepository: EntryRepository = new DexieEntryRepository(database)
export let draftRepository: DraftRepository = new DexieDraftRepository(database)
export let mediaRepository: MediaRepository = new OpfsMediaRepository()

/** Test-only: points the composition root at a different repository instance. */
export function setEntryRepository(repository: EntryRepository): void {
  entryRepository = repository
}

export function setDraftRepository(repository: DraftRepository): void {
  draftRepository = repository
}

export function setMediaRepository(repository: MediaRepository): void {
  mediaRepository = repository
}
