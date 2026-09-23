import type { AuthoringEvent } from '@/types/entry'
import type { Draft, DraftSummary } from '@/types/draft'
import type { DraftRepository, PersistedEvents } from './draftRepository'

/**
 * Events in their own map, appended rather than replaced wholesale, so the contract's append-only
 * assertions actually exercise something — a repository that just stored `Draft` objects whole
 * could not fail them.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private snapshots = new Map<string, Draft>()
  private childEvents = new Map<string, AuthoringEvent[]>()
  private parentEvents = new Map<string, AuthoringEvent[]>()

  async save(draft: Draft, persisted: PersistedEvents): Promise<void> {
    append(this.childEvents, draft.session_id, draft.child.events, persisted.child)
    if (draft.parent) {
      append(this.parentEvents, draft.session_id, draft.parent.events, persisted.parent)
    }

    this.snapshots.set(
      draft.session_id,
      structuredClone({
        ...draft,
        child: { ...draft.child, events: [] },
        parent: draft.parent ? { ...draft.parent, events: [] } : null,
      }),
    )
  }

  async getById(sessionId: string): Promise<Draft | null> {
    const snapshot = this.snapshots.get(sessionId)
    return snapshot ? structuredClone(this.reassemble(snapshot)) : null
  }

  async list(): Promise<DraftSummary[]> {
    // No event maps touched here — `this.snapshots` already carries no events, so a summary needs
    // nothing `reassemble` would add.
    return [...this.snapshots.values()]
      .sort(
        (a, b) =>
          b.updated_at.localeCompare(a.updated_at) || b.session_id.localeCompare(a.session_id),
      )
      .map((snapshot) => structuredClone(toSummary(snapshot)))
  }

  async delete(sessionId: string): Promise<void> {
    this.snapshots.delete(sessionId)
    this.childEvents.delete(sessionId)
    this.parentEvents.delete(sessionId)
  }

  clear(): void {
    this.snapshots.clear()
    this.childEvents.clear()
    this.parentEvents.clear()
  }

  private reassemble(snapshot: Draft): Draft {
    return {
      ...snapshot,
      child: { ...snapshot.child, events: this.childEvents.get(snapshot.session_id) ?? [] },
      parent: snapshot.parent
        ? { ...snapshot.parent, events: this.parentEvents.get(snapshot.session_id) ?? [] }
        : null,
    }
  }
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
