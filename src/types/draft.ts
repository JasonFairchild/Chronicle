import type { AuthoringStep, AuthoringTick, EntryDates } from './entry'

/**
 * What an unsealed draft is going to become. Without it a drafts list could show the words but not
 * say whether they are a new entry, a note on something, or an edit in progress.
 *
 * `new_child` is an **anchor-mode** session (ENTRY_MODEL.md, "Two creation experiences, kept
 * separate"): the parent's own text cannot be touched, only marked, and the sharply limited action
 * set is what a plain content edit here would violate. `revision` is the other mode, ordinary
 * text editing, and the two are never offered in the same session.
 *
 * It carries no relation type: whether the child reads as an annotation or an update is derived at
 * seal time from what was actually anchored, so there is nothing for a session to decide up front.
 *
 * `new_connection` reuses `parent_id`/`target_id` rather than inventing `from_id`/`to_id`: those are
 * exactly the `Entry` fields a connection writes (ENTRY_MODEL.md, "Connections" — `parent_id` is the
 * source, `target_id` the destination), so naming them the same way here means nothing downstream
 * that reads `target.parent_id` generically (`DraftsView.vue`'s `parentIdOf`) needs a special case.
 */
export type DraftTarget =
  | { kind: 'new_root' }
  | { kind: 'new_child'; parent_id: string }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
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
 * the child's own prose, unchanged from every other target; `parent_base_content`,
 * `parent_content`, `parent_steps` and `parent_ticks` are the parent gaining provisional anchors,
 * present only for this target. Separate fields rather than a variant per target keeps every other
 * target's shape exactly as it already was, and a `new_root` or `revision` draft simply never
 * touches the parent fields.
 */
export interface Draft {
  /** Primary key. One session, one draft. */
  session_id: string
  target: DraftTarget
  started_at: string
  updated_at: string
  /** The current document snapshot, serialized the same way an entry's content is. */
  content: string
  /** Dates typed so far, so they survive a reload like the words do. */
  dates: EntryDates
  /** The parent document as this session has provisionally marked it. `new_child` only. */
  parent_content: string | null
  /**
   * The parent as it stood when this session began, never rewritten afterward. `new_child` only.
   *
   * Which anchors this session placed is read from the difference between this and
   * `parent_content` (`anchorsPlacedSince`, `domain/anchors.ts`) rather than tallied into a list of
   * its own — one fact, derived, so undoing or removing an anchor needs nothing kept in step. It is
   * also the record of *which version this session started from*, which is what a future check for
   * a parent revised out from under an open draft would compare against (CHRONICLE_PLAN.md).
   */
  parent_base_content: string | null
  steps: AuthoringStep[]
  /** The parent document's own step chain for this session. `new_child` only. */
  parent_steps: AuthoringStep[]
  ticks: AuthoringTick[]
  /**
   * Bookmarks on the parent's own step chain — one `AuthoringSession` per document (`draftsStore`
   * runs two), each ticked by the same policy, so this is `ticks`' exact counterpart for
   * `parent_steps` rather than a second mechanism. `new_child` only.
   */
  parent_ticks: AuthoringTick[]
}
