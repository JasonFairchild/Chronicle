import type { AuthoringStep } from '@/types/entry'
import type { Draft, DraftSummary } from '@/types/draft'
import type { DraftRepository, PersistedSteps } from './draftRepository'

/**
 * Steps in their own map, appended rather than replaced wholesale, so the contract's append-only
 * assertions actually exercise something — a repository that just stored `Draft` objects whole
 * could not fail them.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private snapshots = new Map<string, Draft>()
  private childSteps = new Map<string, AuthoringStep[]>()
  private parentSteps = new Map<string, AuthoringStep[]>()

  async save(draft: Draft, persisted: PersistedSteps): Promise<void> {
    append(this.childSteps, draft.session_id, draft.child.steps, persisted.child)
    if (draft.parent) {
      append(this.parentSteps, draft.session_id, draft.parent.steps, persisted.parent)
    }

    this.snapshots.set(
      draft.session_id,
      structuredClone({
        ...draft,
        child: { ...draft.child, steps: [] },
        parent: draft.parent ? { ...draft.parent, steps: [] } : null,
      }),
    )
  }

  async getById(sessionId: string): Promise<Draft | null> {
    const snapshot = this.snapshots.get(sessionId)
    return snapshot ? structuredClone(this.reassemble(snapshot)) : null
  }

  async list(): Promise<DraftSummary[]> {
    // No step maps touched here — `this.snapshots` already carries no steps, so a summary needs
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
    this.childSteps.delete(sessionId)
    this.parentSteps.delete(sessionId)
  }

  clear(): void {
    this.snapshots.clear()
    this.childSteps.clear()
    this.parentSteps.clear()
  }

  private reassemble(snapshot: Draft): Draft {
    return {
      ...snapshot,
      child: { ...snapshot.child, steps: this.childSteps.get(snapshot.session_id) ?? [] },
      parent: snapshot.parent
        ? { ...snapshot.parent, steps: this.parentSteps.get(snapshot.session_id) ?? [] }
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
  store: Map<string, AuthoringStep[]>,
  sessionId: string,
  steps: AuthoringStep[],
  persistedCount: number,
): void {
  const existing = store.get(sessionId) ?? []
  const tail = structuredClone(steps.slice(persistedCount))
  store.set(sessionId, [...existing, ...tail])
}
