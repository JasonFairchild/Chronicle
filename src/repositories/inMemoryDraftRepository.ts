import type { Draft } from '@/types/draft'
import type { DraftRepository } from './draftRepository'

export class InMemoryDraftRepository implements DraftRepository {
  private drafts = new Map<string, Draft>()

  async save(draft: Draft): Promise<Draft> {
    this.drafts.set(draft.session_id, structuredClone(draft))
    return structuredClone(draft)
  }

  async getById(sessionId: string): Promise<Draft | null> {
    const draft = this.drafts.get(sessionId)
    return draft ? structuredClone(draft) : null
  }

  async list(): Promise<Draft[]> {
    return [...this.drafts.values()]
      .sort(
        (a, b) =>
          b.updated_at.localeCompare(a.updated_at) || b.session_id.localeCompare(a.session_id),
      )
      .map((draft) => structuredClone(draft))
  }

  async delete(sessionId: string): Promise<void> {
    this.drafts.delete(sessionId)
  }

  clear(): void {
    this.drafts.clear()
  }
}
