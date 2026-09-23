import type { AuthoringEvent, EditEvent } from '@/types/entry'

/**
 * Marks: the moments in a writing session worth stopping at when reviewing it (ENTRY_MODEL.md,
 * "Authoring capture"). Derived from the session's event log rather than decided while the writer
 * types, so a recorded session can be read under any policy, including one written later.
 */

export type MarkReason =
  | 'pause'
  | 'paste'
  | 'media'
  | 'deletion'
  | 'punctuation'
  | 'pattern'
  | 'interval'
  | 'format'
  | 'anchor'
  | 'manual'

/**
 * A moment worth stopping at. `index` counts the events before it, so the marked document is
 * `events.slice(0, index)` applied to the trace's `base_content`.
 */
export interface AuthoringMark {
  at: number // The `at` of the event that placed it.
  index: number
  reasons: MarkReason[] // Never empty. By priority, so a single label reads `reasons[0]`.
}

/**
 * The thresholds are the product decision most likely to be wrong at first, so they are data, and
 * changing them re-reads every stored session rather than only the ones written afterwards.
 */
export interface MarkPolicy {
  pauseMs: number // A gap this long before an edit means the writer stopped and came back.
  intervalMs: number // However steadily someone types, mark at least this often.
  punctuation: string // Inserted text ending in any of these characters ends a markable unit.
  triggerPatterns: RegExp[] // Inserted text matching any of these is worth a mark of its own.
  minMarkGapMs: number // A mark this close to the previous one merges into it. See `place`.
}

export const DEFAULT_MARK_POLICY: MarkPolicy = {
  pauseMs: 30_000,
  intervalMs: 60_000,
  punctuation: '.!?',
  triggerPatterns: [],
  minMarkGapMs: 2_000,
}

/**
 * Most worth showing first: what the writer deliberately did (`manual`, then the app's distinctive
 * actions) outranks ordinary editing, which outranks the ambient signals of timing and sentence
 * endings. `pause` describes when, not what, and co-occurs with nearly anything after a break, so
 * it must not mask a paste or a deletion as the label. `pattern` is a match the writer configured,
 * so it counts as a what.
 */
const MARK_REASON_PRIORITY: readonly MarkReason[] = [
  'manual',
  'anchor',
  'media',
  'pattern',
  'paste',
  'deletion',
  'format',
  'pause',
  'punctuation',
  'interval',
]

/** Orders reasons by `MARK_REASON_PRIORITY` and drops duplicates. */
function sortByPriority(reasons: readonly MarkReason[]): MarkReason[] {
  return MARK_REASON_PRIORITY.filter((reason) => reasons.includes(reason))
}

/**
 * Every mark `policy` finds in a session's log, in one pass.
 *
 * `deletion` is the one reason judged in retrospect: a run of deleting edits is marked when it
 * ends — at an edit that removes nothing, a deleting edit after a pause, a manual mark, or the end
 * of the log — and the mark sits at the run's last deleting edit, so it covers everything removed
 * in one go. It is placed before the closing event's own mark, which keeps marks in log order.
 */
export function deriveMarks(
  events: readonly AuthoringEvent[],
  policy: MarkPolicy = DEFAULT_MARK_POLICY,
): AuthoringMark[] {
  const marks: AuthoringMark[] = []
  let lastEditAt: number | null = null // Manual marks never move it: a pause is a gap in writing.
  let openDeletion: AuthoringMark | null = null // Moves up with each edit in the run.

  const closeDeletionRun = () => {
    if (openDeletion) place(marks, openDeletion, policy.minMarkGapMs)
    openDeletion = null
  }

  for (const [i, event] of events.entries()) {
    const index = i + 1

    if (event.kind === 'manual') {
      closeDeletionRun()
      place(marks, { at: event.at, index, reasons: ['manual'] }, policy.minMarkGapMs)
      continue
    }

    const paused = lastEditAt !== null && event.at - lastEditAt >= policy.pauseMs
    const removesText = (event.removed_chars ?? 0) > 0
    if (!removesText || paused) closeDeletionRun()
    if (removesText) openDeletion = { at: event.at, index, reasons: ['deletion'] }

    // Seeded at the session's start, so steady typing that never pauses is still marked.
    const lastMarkAt = marks[marks.length - 1]?.at ?? 0
    const reasons = reasonsFor(event, paused, lastMarkAt, policy)
    place(marks, { at: event.at, index, reasons }, policy.minMarkGapMs)
    lastEditAt = event.at
  }

  closeDeletionRun()
  return marks
}

/**
 * Every reason an edit is worth marking, not a choice between them: one edit can satisfy several,
 * such as a sentence finished right after a long pause. Empty means nothing to mark.
 */
function reasonsFor(
  edit: EditEvent,
  paused: boolean,
  lastMarkAt: number,
  policy: MarkPolicy,
): MarkReason[] {
  const inserted = edit.inserted_text ?? ''
  const lastChar = inserted.slice(-1)
  const reasons: MarkReason[] = []

  if (paused) reasons.push('pause')
  if (edit.is_paste) reasons.push('paste')
  if (edit.media_changed) reasons.push('media')
  // The emptiness guard matters: `includes('')` is true for any string.
  if (lastChar !== '' && policy.punctuation.includes(lastChar)) reasons.push('punctuation')
  if (policy.triggerPatterns.some((pattern) => pattern.test(inserted))) reasons.push('pattern')
  if (edit.is_anchor_op) reasons.push('anchor')
  if (edit.is_formatting) reasons.push('format')
  if (edit.at - lastMarkAt >= policy.intervalMs) reasons.push('interval')

  return sortByPriority(reasons)
}

/**
 * Appends `mark`, or merges it into the previous mark when it lands within `minGapMs` — what keeps
 * bolding eight words one at a time from becoming eight stops. The merged mark moves up to the end
 * of the cluster it now represents, and the reasons union. A manual mark never merges in either
 * direction: the writer placed it deliberately.
 */
function place(marks: AuthoringMark[], mark: AuthoringMark, minGapMs: number): void {
  if (mark.reasons.length === 0) return

  const last = marks[marks.length - 1]
  const merges =
    last !== undefined &&
    mark.at - last.at < minGapMs &&
    !last.reasons.includes('manual') &&
    !mark.reasons.includes('manual')

  if (merges) {
    last.at = mark.at
    last.index = mark.index
    last.reasons = sortByPriority([...last.reasons, ...mark.reasons])
  } else {
    marks.push(mark)
  }
}
