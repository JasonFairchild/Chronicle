import { newDraftEntry, type Draft, type DraftDocument, type DraftEntry } from '@/types/draft'

export const DRAFT_STARTED_AT = '2026-09-05T10:00:00.000Z'

/** What a draft will become: its kind and the fields that kind carries. */
type DraftKindPart = Draft extends infer D
  ? D extends unknown
    ? Omit<D, 'session_id' | 'started_at' | 'updated_at' | 'entry'>
    : never
  : never

/**
 * A draft as a reload would find it, a new root entry unless `kind` says otherwise. Its entry is
 * an empty new one under `entry`, with no events unless given.
 */
export function makeDraft(
  sessionId: string,
  entry: Partial<DraftEntry> = {},
  kind: DraftKindPart = { kind: 'new_root' },
  updatedAt = DRAFT_STARTED_AT,
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
 * An anchor-mode draft's parent document: `base` as the session found it at version `versionId`
 * (the parent's own id for version one), `content` now.
 */
export function parentDocument(
  versionId: string,
  base: string,
  content = base,
  events: DraftDocument['events'] = [],
): DraftDocument {
  return { base_version_id: versionId, base_content: base, content, events }
}
