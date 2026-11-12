import Dexie from 'dexie'
import { createPinia, type Pinia, type PiniaPluginContext } from 'pinia'
import { createApp } from 'vue'

import {
  draftRepository,
  entryRepository,
  markSetRepository,
  mediaRepository,
} from '@/repositories'
import { ChronicleDatabase } from '@/repositories/chronicleDatabase'

// Specs run on the composition root's own storage, emptied before and after each test. A write
// still running when a test ends would land in the next, so `endTest` first drains every writer:
// the three stores and `useMedia`, the only source eslint.config.js lets import `@/repositories`.
// After that, an action on the ended test's Pinia, or any repository call before the next test
// begins, fails a test rather than landing quietly.

/** Well inside the hook timeout, so a hang fails the test that left it, naming what still runs. */
const DRAIN_LIMIT_MS = 5_000

const draftsStores = new Set<{ flushAll(): Promise<void> }>()
/** Each action and repository call still running, named for the report if it never finishes. */
const running = new Map<Promise<void>, string>()
const leaks: string[] = []
/** Repository calls, not actions: each drain pass starts an action itself, `flushAll`. */
let callsStarted = 0
let betweenTests = false
/** Counts ended tests, so a Pinia made for an earlier one can tell. */
let currentTest = 0

function track(work: Promise<unknown>, label: string): void {
  const settled = work.then(
    () => {},
    () => {},
  )
  running.set(settled, label)
  void settled.then(() => running.delete(settled))
}

/** Records each call to `repository` until it settles, and any made between tests. */
function trackCalls(label: string, repository: object): void {
  const target = repository as Record<string, unknown>
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repository)).filter(
    (name) => name !== 'constructor' && typeof target[name] === 'function',
  )
  for (const name of methods) {
    const method = target[name] as (...args: unknown[]) => unknown
    target[name] = (...args: unknown[]) => {
      if (betweenTests) leaks.push(`${label}.${name} called after its test ended`)
      const result = method.apply(repository, args)
      if (result instanceof Promise) {
        callsStarted++
        track(result, `${label}.${name}`)
      }
      return result
    }
  }
}

trackCalls('entryRepository', entryRepository)
trackCalls('draftRepository', draftRepository)
trackCalls('markSetRepository', markSetRepository)
trackCalls('mediaRepository', mediaRepository)

/** Tracks each action until it settles, and refuses one once the Pinia's `test` has ended. */
function trackStore(test: number) {
  return ({ store }: PiniaPluginContext): void => {
    if (store.$id === 'drafts') draftsStores.add(store as unknown as { flushAll(): Promise<void> })

    store.$onAction(({ name, after, onError }) => {
      if (test !== currentTest) {
        const leak = `${store.$id}.${name} ran on a Pinia whose test has ended`
        leaks.push(leak)
        throw new Error(leak)
      }
      const done = new Promise<void>((resolve) => {
        after(() => resolve())
        onError(() => resolve())
      })
      track(done, `${store.$id}.${name}`)
    })
  }
}

/** The one way a spec makes a Pinia, so teardown can drain it and refuse it afterwards. */
export function createTrackedPinia(): Pinia {
  const pinia = createPinia()
  // Installed at once: Pinia holds a plugin back until then, and a Pinia a spec only activates
  // (`setActivePinia`, every node spec) is otherwise never installed, so nothing would be tracked.
  createApp({}).use(pinia)
  pinia.use(trackStore(currentTest))
  return pinia
}

/**
 * Resolves once nothing is left to write: every draft written now rather than on its timer, every
 * action and repository call settled. Repeats until a pass starts nothing, since each can start
 * more (a flush meeting a conflict reads back, an action awaits between calls). No pass starts past
 * `deadline`, so a drain given up on can't flush the next test's drafts.
 */
async function drain(deadline: number): Promise<'drained' | 'hung'> {
  while (Date.now() < deadline) {
    const before = callsStarted
    await Promise.all([...draftsStores].map((store) => store.flushAll()))
    while (running.size > 0) await Promise.all(running.keys())
    // A task, not a microtask: code awaiting what just settled (a view's own async function, its
    // component long unmounted) resumes first, and may start the next action.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (callsStarted === before && running.size === 0) return 'drained'
  }
  return 'hung'
}

/** What is still running `DRAIN_LIMIT_MS` after the drain began, now forgotten; none if it ended. */
async function drainWithin(): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<'hung'>((resolve) => {
    timer = setTimeout(() => resolve('hung'), DRAIN_LIMIT_MS)
  })
  const outcome = await Promise.race([drain(Date.now() + DRAIN_LIMIT_MS), limit])
  clearTimeout(timer)
  if (outcome === 'drained') return []

  // Nothing left running means every pass started more, none of it hanging.
  const stuck = running.size > 0 ? [...running.values()] : ['work that kept starting more']
  running.clear()
  return stuck
}

let database: ChronicleDatabase | null = null

/** Empties every table through a connection of its own, and the media directory. */
async function clearStorage(): Promise<void> {
  // In node, a spec that never touched storage pays nothing.
  if (database || (await Dexie.exists('chronicle'))) {
    database ??= new ChronicleDatabase()
    const db = database
    await db.transaction('rw', db.tables, () =>
      Promise.all(db.tables.map((table) => table.clear())),
    )
  }

  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry('media', { recursive: true })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
}

/** Fails the hook it runs in if anything wrote after its test ended. */
function reportLeaks(): void {
  const found = leaks.splice(0)
  if (found.length > 0) throw new Error(`Late writes reached storage:\n${found.join('\n')}`)
}

/** Before each test: empty storage, whatever the last test, file or aborted run left. */
export async function beginTest(): Promise<void> {
  reportLeaks()
  await clearStorage()
  betweenTests = false
}

/** After each test, once its component is unmounted: drain, retire its Pinias, then empty storage. */
export async function endTest(): Promise<void> {
  const stuck = await drainWithin()
  betweenTests = true
  currentTest++
  draftsStores.clear()
  await clearStorage()

  if (stuck.length > 0) {
    throw new Error(`Still running ${DRAIN_LIMIT_MS} ms after the test ended:\n${stuck.join('\n')}`)
  }
  reportLeaks()
}
