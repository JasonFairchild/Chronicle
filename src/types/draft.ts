import type { AuthoringStep, AuthoringTick, EntryDates } from './entry'

/**
 * What an unsealed draft is going to become. `new_child` is anchor-mode (ENTRY_MODEL.md, "Two
 * creation experiences"); `revision` is ordinary text editing. `new_connection` reuses
 * `parent_id`/`target_id` since those are exactly the `Entry` fields a connection writes.
 */
export type DraftTarget =
  | { kind: 'new_root' }
  | { kind: 'new_child'; parent_id: string }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent_id: string }

/**
 * A writing session in progress — the one sanctioned mutable store (ENTRY_MODEL.md, "Drafts").
 * `new_child` edits two documents at once: `content` is the child's own prose; `parent_content` /
 * `parent_base_content` / `parent_steps` / `parent_ticks` are the parent gaining provisional
 * anchors. Every other target leaves the parent fields untouched.
 */
export interface Draft {
  session_id: string
  target: DraftTarget
  started_at: string
  updated_at: string
  /** The current document snapshot, serialized the same way an entry's content is. */
  content: string
  dates: EntryDates
  steps: AuthoringStep[]
  ticks: AuthoringTick[]

  /** `new_child` only — the parent gaining provisional anchors. */
  parent_content: string | null
  /** Unchanged since the session began — the diffing baseline for `anchorsPlacedSince`. */
  parent_base_content: string | null
  parent_steps: AuthoringStep[]
  parent_ticks: AuthoringTick[]
}
