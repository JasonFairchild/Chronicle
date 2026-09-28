import type { AuthoringEvent, CreateEntryInput, Entry } from '@/types/entry'
import { toSnapshot, withEvents, type Draft, type DraftSnapshot } from '@/types/draft'
import { DraftConflictError, type DraftRepository, type PersistedEvents } from './draftRepository'
import type { EntryRepository } from './entryRepository'

/**
 * Events in their own map, appended rather than replaced wholesale, so the contract's append-only
 * assertions actually exercise something — a repository that just stored `Draft` objects whole
 * could not fail them.
 *
 * `entries` is where a seal writes, and has to be the repository everything else reads from.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private snapshots = new Map<string, DraftSnapshot>()
  private entryEvents = new Map<string, AuthoringEvent[]>()
  private parentEvents = new Map<string, AuthoringEvent[]>()

  constructor(private readonly entries: EntryRepository) {}

  async save(draft: Draft, persisted: PersistedEvents): Promise<void> {
    const logs: [Map<string, AuthoringEvent[]>, AuthoringEvent[], number][] = [
      [this.entryEvents, draft.entry.events, persisted.entry],
    ]
    if (draft.kind === 'new_related') {
      logs.push([this.parentEvents, draft.parent.events, persisted.parent])
    }

    // Every log is checked before any is written, so a refusal leaves the draft as it was.
    for (const [store, events, persistedCount] of logs) {
      const stored = store.get(draft.session_id)?.length ?? 0
      if (events.length > persistedCount && stored > persistedCount) {
        throw new DraftConflictError()
      }
    }

    for (const [store, events, persistedCount] of logs) {
      append(store, draft.session_id, events, persistedCount)
    }
    this.snapshots.set(draft.session_id, structuredClone(toSnapshot(draft)))
  }

  async getById(sessionId: string): Promise<Draft | null> {
    const snapshot = this.snapshots.get(sessionId)
    return snapshot ? structuredClone(this.reassemble(snapshot)) : null
  }

  async list(): Promise<DraftSnapshot[]> {
    // No event maps touched here — `this.snapshots` already carries no events.
    return [...this.snapshots.values()]
      .sort(
        (a, b) =>
          b.updated_at.localeCompare(a.updated_at) || b.session_id.localeCompare(a.session_id),
      )
      .map((snapshot) => structuredClone(snapshot))
  }

  async seal(sessionId: string, inputs: CreateEntryInput[]): Promise<Entry[]> {
    // `createMany` is all-or-nothing and removing a draft can't fail, so writing first is enough.
    const created = await this.entries.createMany(inputs)
    await this.delete(sessionId)
    return created
  }

  async delete(sessionId: string): Promise<void> {
    this.snapshots.delete(sessionId)
    this.entryEvents.delete(sessionId)
    this.parentEvents.delete(sessionId)
  }

  clear(): void {
    this.snapshots.clear()
    this.entryEvents.clear()
    this.parentEvents.clear()
  }

  private reassemble(snapshot: DraftSnapshot): Draft {
    return withEvents(snapshot, {
      entry: this.entryEvents.get(snapshot.session_id) ?? [],
      parent: this.parentEvents.get(snapshot.session_id) ?? [],
    })
  }
}

function append(
  store: Map<string, AuthoringEvent[]>,
  sessionId: string,
  events: AuthoringEvent[],
  persistedCount: number,
): void {
  const existing = store.get(sessionId) ?? []
  const tail = structuredClone(events.slice(persistedCount))
  store.set(sessionId, [...existing, ...tail])
}
