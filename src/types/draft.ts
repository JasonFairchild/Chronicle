import type { AuthoringStep, AuthoringTick, EntryDates } from './entry'

/**
 * What an unsealed draft is going to become. `new_child` is for anchor-mode (ENTRY_MODEL.md,
 * "Two creation experiences"); `revision` is ordinary text editing. `new_connection` reuses
 * `parent_id`/`target_id` since those are exactly the `Entry` fields a connection writes.
 */
export type DraftTarget =
  | { kind: 'new_root' }
  | { kind: 'new_child'; parent_id: string }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent_id: string }

/**
 * One document's live snapshot plus its trace-in-progress — an `AuthoringTrace` before it has an
 * `ended_at`, because the session it belongs to hasn't yet sealed.
 */
export interface AuthoringBuffer {
  content: string
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
}

/**
 * A writing session in progress — the one sanctioned mutable store (ENTRY_MODEL.md, "Drafts").
 * `child` becomes the entry this draft is chiefly for. `parent` exists only for `new_child`
 * (anchor-mode): if the parent gains provisional anchors, they seal into its own revision.
 */
export interface Draft {
  session_id: string
  target: DraftTarget
  // started_at serves both the child and parent AuthoringTrace when sealing
  started_at: string
  updated_at: string
  dates: EntryDates
  title: string | null
  child: AuthoringBuffer
  // Its own `title`, mirrored once when the session begins
  parent: (AuthoringBuffer & { base_content: string; title: string | null }) | null
}

/**
 * A `Draft` without its step/tick chains — what the drafts list actually needs. Opening it is one
 * query across every unsealed session; reading each one's whole authoring history just to render a
 * preview line would make that query's cost grow with how long people have been writing, not with
 * how many drafts exist.
 */
export interface DraftSummary extends Omit<Draft, 'child' | 'parent'> {
  child: Pick<AuthoringBuffer, 'content'>
  parent: (Pick<AuthoringBuffer, 'content'> & { base_content: string; title: string | null }) | null
}
