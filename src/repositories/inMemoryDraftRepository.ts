import { type Draft, type DraftSnapshot, toSnapshot, withEvents } from '@/types/draft'
import type { AuthoringEvent, CreateEntryInput, Entry } from '@/types/entry'
import { newId } from '@/utils/id'

import { assertFollows, type DraftRepository } from './draftRepository'
import type { EntryRepository } from './entryRepository'

/** Appends what `events` holds past the stored log, which is always where it starts. */
function append(
  store: Map<string, AuthoringEvent[]>,
  sessionId: string,
  events: AuthoringEvent[],
): void {
  const existing = store.get(sessionId) ?? []
  store.set(sessionId, [...existing, ...structuredClone(events.slice(existing.length))])
}

/**
 * Events in their own map, appended rather than replaced wholesale, so the contract's append-only
 * assertions actually exercise something — a repository that just stored `Draft` objects whole
 * could not fail them.
 *
 * Nothing here is transactional, so each write checks the write it follows once, before its first
 * `await`: a check after one could refuse a write half done.
 *
 * `entries` is where a seal writes, and has to be the repository everything else reads from.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private snapshots = new Map<string, DraftSnapshot>()
  private entryEvents = new Map<string, AuthoringEvent[]>()
  private parentEvents = new Map<string, AuthoringEvent[]>()

  constructor(private readonly entries: EntryRepository) {}

  async save(draft: Draft): Promise<string> {
    const { session_id: sessionId } = draft
    assertFollows(this.snapshots.get(sessionId), draft.write_id)

    const writeId = newId()
    append(this.entryEvents, sessionId, draft.entry.events)
    if (draft.kind === 'new_related') append(this.parentEvents, sessionId, draft.parent.events)
    this.snapshots.set(sessionId, structuredClone({ ...toSnapshot(draft), write_id: writeId }))
    return writeId
  }

  private reassemble(snapshot: DraftSnapshot): Draft {
    return withEvents(snapshot, {
      entry: this.entryEvents.get(snapshot.session_id) ?? [],
      parent: this.parentEvents.get(snapshot.session_id) ?? [],
    })
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

  private remove(sessionId: string): void {
    this.snapshots.delete(sessionId)
    this.entryEvents.delete(sessionId)
    this.parentEvents.delete(sessionId)
  }

  async seal(
    sessionId: string,
    inputs: CreateEntryInput[],
    follows: string | null,
  ): Promise<Entry[]> {
    // Checked before any entry is written, and never again: a write landing while `createMany`
    // awaits mustn't strand its entries. `createMany` is all-or-nothing and `remove` can't fail.
    assertFollows(this.snapshots.get(sessionId), follows)
    const created = await this.entries.createMany(inputs)
    this.remove(sessionId)
    return created
  }

  async delete(sessionId: string, follows: string | null): Promise<void> {
    const stored = this.snapshots.get(sessionId)
    if (stored) assertFollows(stored, follows)

    this.remove(sessionId)
  }
}
