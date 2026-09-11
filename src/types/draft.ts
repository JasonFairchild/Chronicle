import type { AnchorOp, AuthoringStep, AuthoringTick, NarrativeRelation } from './entry'

/**
 * What an unsealed draft is going to become. Without it a drafts list could show the words but not
 * say whether they are a new entry, a note on something, or an edit in progress.
 */
export type DraftTarget =
  | { kind: 'new_root' }
  // Narrowed to the narrative relations on purpose: a connection is two picked entries and a
  // sentence, composed in one gesture, so nothing about it needs a durable session.
  | { kind: 'new_child'; parent_id: string; relation_type: NarrativeRelation }
  | { kind: 'revision'; parent_id: string; base_version_id: string | null }

/**
 * A writing session in progress. See ENTRY_MODEL.md: this is the one sanctioned mutable store,
 * and it exists precisely so the entries table never has to be.
 *
 * A draft is very nearly the entry it will become, which is exactly why it must not live among the
 * entries. Entries are immutable; a draft rewrites itself every few hundred milliseconds. Keeping
 * them apart means no entry query ever filters drafts out and a half-written thought can never
 * appear in history or a timeline.
 */
export interface Draft {
  /** Primary key. One session, one draft. */
  session_id: string
  target: DraftTarget
  started_at: string
  updated_at: string
  /** The current document snapshot, serialized the same way an entry's content is. */
  content: string
  /** Ops being composed, for a child draft. */
  anchors: AnchorOp[]
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
}
