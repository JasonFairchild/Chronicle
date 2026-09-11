import type { AuthoringStep, AuthoringTick, NarrativeRelation } from './entry'

/**
 * What an unsealed draft is going to become. Without it a drafts list could show the words but not
 * say whether they are a new entry, a note on something, or an edit in progress.
 *
 * `new_child` is an **anchor-mode** session (ENTRY_MODEL.md, "Two creation experiences, kept
 * separate"): the parent's own text cannot be touched, only marked, and the sharply limited action
 * set is what a plain content edit here would violate. `revision` is the other mode, ordinary
 * text editing, and the two are never offered in the same session.
 */
export type DraftTarget =
  | { kind: 'new_root' }
  | { kind: 'new_child'; parent_id: string; relation_type: NarrativeRelation }
  | { kind: 'revision'; parent_id: string }

/**
 * A writing session in progress. See ENTRY_MODEL.md: this is the one sanctioned mutable store,
 * and it exists precisely so the entries table never has to be.
 *
 * A draft is very nearly the entry it will become, which is exactly why it must not live among the
 * entries. Entries are immutable; a draft rewrites itself every few hundred milliseconds. Keeping
 * them apart means no entry query ever filters drafts out and a half-written thought can never
 * appear in history or a timeline.
 *
 * A `new_child` draft edits **two** documents at once, per "Drafts" in ENTRY_MODEL.md: `content` is
 * the child's own prose, unchanged from every other target; `parent_content` and `parent_steps` are
 * the parent gaining provisional anchors, present only for this target. Two separate fields rather
 * than a variant per target keeps every other target's shape exactly as it already was, and a
 * `new_root` or `revision` draft simply never touches the parent fields.
 */
export interface Draft {
  /** Primary key. One session, one draft. */
  session_id: string
  target: DraftTarget
  started_at: string
  updated_at: string
  /** The current document snapshot, serialized the same way an entry's content is. */
  content: string
  /** Ids of the anchors this session has placed in `parent_content`, in the order placed. */
  anchor_ids: string[]
  /** The parent document as this session has provisionally marked it. `new_child` only. */
  parent_content: string | null
  steps: AuthoringStep[]
  /** The parent document's own step chain for this session. `new_child` only. */
  parent_steps: AuthoringStep[]
  ticks: AuthoringTick[]
}
