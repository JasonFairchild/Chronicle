import type { EntryDocument } from '@/domain/entryDocument'
import type { AuthoringMark, MarkPolicy } from '@/domain/marks'

/**
 * Something a frame's view should point at, in ProseMirror positions within that frame's own
 * document — a ruler that never leaves the frame (AUTHORING.md, "Mark sets").
 */
export interface FrameChange {
  kind: 'added' | 'removed' | 'formatted' | 'anchor'
  from: number
  to: number
  /** What a 'removed' change took out, to show struck at `from`. */
  removed?: string
}

/** One mark's stop: what changed since the previous mark's document. */
export interface MarkFrame extends AuthoringMark {
  /** Usually one replace step. A whole document only when that step failed its build-time check. */
  net: { steps: unknown[] } | { document: EntryDocument }
  changes: FrameChange[]
}

/**
 * A session's marks under one policy, each with its frame. A regenerable cache of the entry's
 * trace plus the policy, so unlike entries it may be deleted and rebuilt.
 */
export interface MarkSet {
  id: string
  entry_id: string
  name: string
  created_at: string
  /** Kept so the set can be explained or rebuilt. */
  policy: MarkPolicy
  /** A copy of the trace's base version, so the frames can be viewed without reading it. */
  base_content: string
  frames: MarkFrame[]
}

export type CreateMarkSetInput = Omit<MarkSet, 'id' | 'created_at'>

/** Oldest first, tied on id as entries are (ENTRY_MODEL.md, "Fields"). */
export function compareMarkSets(a: MarkSet, b: MarkSet): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}
