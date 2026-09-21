import type { AuthoringStep } from '@/types/entry'
import type { Draft, DraftSummary } from '@/types/draft'
import { resolveDatabase, type ChronicleDatabase, type StoredDraftStep } from './chronicleDatabase'
import type { DraftRepository, PersistedSteps } from './draftRepository'

/**
 * Drafts on disk, not in memory. That is the whole reason a crash costs nothing: every debounced
 * flush lands in the same local-first store the entries use, so a closed laptop loses at most the
 * few hundred milliseconds of typing since the last one.
 */
export class DexieDraftRepository implements DraftRepository {
  private db: ChronicleDatabase

  constructor(database: ChronicleDatabase | string = 'chronicle') {
    this.db = resolveDatabase(database)
  }

  async save(draft: Draft, persisted: PersistedSteps): Promise<void> {
    const newSteps = [
      ...stepRows(draft.session_id, 'child', draft.child.steps, persisted.child),
      ...(draft.parent
        ? stepRows(draft.session_id, 'parent', draft.parent.steps, persisted.parent)
        : []),
    ]

    // The snapshot row never carries steps: they live in `draftSteps` from here on, appended
    // rather than rewritten, and reassembled by `getById`/`list`.
    const snapshot: Draft = {
      ...draft,
      child: { ...draft.child, steps: [] },
      parent: draft.parent ? { ...draft.parent, steps: [] } : null,
    }

    // One transaction: a crash between the two writes must not leave steps on disk that the
    // snapshot's own step count doesn't yet account for, or vice versa.
    await this.db.transaction('rw', this.db.drafts, this.db.draftSteps, async () => {
      // `put`, not `add`: overwriting is the point of this store, and it is why drafts are kept
      // out of the entries table rather than being a flag on it. The clone guards a narrower race
      // than crash recovery (that fidelity comes from the durable step chain): Dexie holds this
      // object by reference until it reaches the real `IDBObjectStore.put()` a microtask or two
      // later, and cloning keeps a keystroke landing in that window from mutating an in-flight
      // write.
      await this.db.drafts.put(structuredClone(snapshot))
      if (newSteps.length > 0) {
        await this.db.draftSteps.bulkPut(structuredClone(newSteps))
      }
    })
  }

  async getById(sessionId: string): Promise<Draft | null> {
    const draft = await this.db.drafts.get(sessionId)
    if (!draft) return null

    return reassemble(draft, await this.stepsFor(sessionId))
  }

  async list(): Promise<DraftSummary[]> {
    const drafts = await this.db.drafts.orderBy('updated_at').reverse().toArray()
    // `updated_at` is millisecond-resolution, so two drafts flushed in the same tick would
    // otherwise come back in whatever order the index happened to hold them.
    const sorted = drafts.sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.session_id.localeCompare(a.session_id),
    )

    // No `draftSteps` query here — that's the whole point. The snapshot row carries no steps, so a
    // summary needs nothing this query didn't already fetch.
    return sorted.map(toSummary)
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.transaction('rw', this.db.drafts, this.db.draftSteps, async () => {
      await this.db.drafts.delete(sessionId)
      await this.db.draftSteps.where('session_id').equals(sessionId).delete()
    })
  }

  private async stepsFor(sessionId: string): Promise<StoredDraftStep[]> {
    return this.db.draftSteps.where('session_id').equals(sessionId).toArray()
  }

  /** Closes this instance's connection without deleting the database. */
  close(): void {
    this.db.close()
  }

  /** Test-only: deletes the underlying IndexedDB database and closes this instance. */
  async dispose(): Promise<void> {
    await this.db.delete()
  }
}

function stepRows(
  sessionId: string,
  document: 'child' | 'parent',
  steps: AuthoringStep[],
  persistedCount: number,
): StoredDraftStep[] {
  return steps.slice(persistedCount).map((step, i) => ({
    ...step,
    session_id: sessionId,
    document,
    index: persistedCount + i,
  }))
}

function toSummary(draft: Draft): DraftSummary {
  return {
    ...draft,
    child: { content: draft.child.content },
    parent: draft.parent
      ? {
          content: draft.parent.content,
          title: draft.parent.title,
          base_content: draft.parent.base_content,
        }
      : null,
  }
}

function reassemble(draft: Draft, rows: StoredDraftStep[]): Draft {
  const byDocument = (document: 'child' | 'parent') =>
    rows
      .filter((row) => row.document === document)
      .sort((a, b) => a.index - b.index)
      .map((row): AuthoringStep => ({ at: row.at, step: row.step }))

  return {
    ...draft,
    child: { ...draft.child, steps: byDocument('child') },
    parent: draft.parent ? { ...draft.parent, steps: byDocument('parent') } : null,
  }
}
