import type { DraftRepository } from '@/repositories/draftRepository'
import { newDraftEntry, type Draft, type DraftDocument, type DraftEntry } from '@/types/draft'
import type { Entry } from '@/types/entry'

const DRAFT_STARTED_AT = '2026-09-05T10:00:00.000Z'

/** What a draft will become: its kind and the fields that kind carries. */
export type DraftKind = Draft extends infer D
  ? D extends unknown
    ? Omit<D, 'session_id' | 'started_at' | 'updated_at' | 'entry'>
    : never
  : never

/**
 * A draft as a reload would find it: a new root entry unless `kind` says otherwise, its entry an
 * empty new one under `entry`, with no events unless given.
 */
export function makeDraft(
  sessionId: string,
  {
    entry = {},
    kind = { kind: 'new_root' },
    updatedAt = DRAFT_STARTED_AT,
  }: { entry?: Partial<DraftEntry>; kind?: DraftKind; updatedAt?: string } = {},
): Draft {
  return {
    session_id: sessionId,
    started_at: DRAFT_STARTED_AT,
    updated_at: updatedAt,
    entry: { ...newDraftEntry(), events: [], ...entry },
    ...kind,
  }
}

/**
 * A related-entry draft's kind, on `parent` as the session found it at version one. `since` is
 * what the session has done to the parent: anchor marks in its `content`, and their `events`.
 */
export function relatedTo(
  parent: Pick<Entry, 'id' | 'content'>,
  since: Partial<Pick<DraftDocument, 'content' | 'events'>> = {},
): DraftKind {
  return {
    kind: 'new_related',
    parent_id: parent.id,
    parent: {
      base_version_id: parent.id,
      base_content: parent.content,
      content: parent.content,
      events: [],
      ...since,
    },
  }
}

/** Stores `draft` as a first save would, with none of its events on disk yet. */
export async function seedDraft(drafts: DraftRepository, draft: Draft): Promise<void> {
  await drafts.save(draft, { entry: 0, parent: 0 })
}
