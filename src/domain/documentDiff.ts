/**
 * What changed between two versions of an entry, as something a reader can see rather than as the
 * steps that produced it. See PRODUCT.md §5.2.
 *
 * Measured against `docToPlainText`, like every other reading of a document (CLAUDE.md, Landmarks),
 * so a diff, a preview, and a search hit all agree to the character on what an entry says. Two
 * consequences worth naming, both of them deliberate: anchor-carried wording never appears here,
 * since it belongs to the child entry that proposed it rather than to this document's author, and a
 * formatting-only revision produces no diff at all, because bolding a sentence changes how it reads
 * and not what it says.
 *
 * Nothing here interprets authoring steps. A diff is a comparison of two outcomes — the same
 * reasoning `contentDelta` is built on — which is what lets it work between any two versions,
 * including ones whose steps were never captured or can no longer be replayed.
 *
 * Whether such a view should also show a parent's anchor ops alongside the words is an open product
 * question (PRODUCT.md §6) and deliberately not answered here.
 */

import { docToPlainText, type EntryDocument } from './entryDocument'

export type DiffKind = 'unchanged' | 'added' | 'removed'

/**
 * One run of text that survived, arrived, or left. Concatenating every non-`removed` segment's text
 * reproduces the later version exactly; every non-`added` one reproduces the earlier.
 */
export interface DiffSegment {
  kind: DiffKind
  text: string
}

/**
 * Past this many differing tokens on a side, the alignment below is abandoned for a whole-block
 * replacement. The table it builds is quadratic, and this is where the cost stops being worth
 * paying — not a guard against the impossible: an entry rewritten from scratch genuinely has
 * nothing to align, and "all of this went, all of that arrived" is the honest rendering of one
 * anyway. Ordinary revisions never come near it, since the shared prefix and suffix are removed
 * before anything is measured.
 */
const MAX_ALIGNED_TOKENS = 2_000

/** The diff between two stored documents. The entry point a revision view wants. */
export function diffDocuments(
  before: string | EntryDocument,
  after: string | EntryDocument,
): DiffSegment[] {
  return diffPlainText(docToPlainText(before), docToPlainText(after))
}

/**
 * The diff between two plain strings, word by word. Public because the entry's title is plain text
 * living beside the document rather than inside it (ENTRY_MODEL.md, "Fields"), so renaming shows up
 * here and not in `diffDocuments`.
 *
 * Words rather than characters: a reader comparing two versions of a sentence wants to see which
 * words changed, not that the 14th character became a "t". Whitespace rides along with the words
 * rather than being trimmed away, so the segments still concatenate back into the exact text — the
 * line breaks between blocks included.
 */
export function diffPlainText(before: string, after: string): DiffSegment[] {
  const a = tokenize(before)
  const b = tokenize(after)

  // The shared head and tail, which a revision usually leaves almost entirely alone. Removing them
  // first is what keeps the alignment below measuring the handful of words that actually changed.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++

  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }

  const removed = a.slice(head, a.length - tail)
  const added = b.slice(head, b.length - tail)

  const segments: DiffSegment[] = []
  push(segments, 'unchanged', a.slice(0, head).join(''))

  if (removed.length > MAX_ALIGNED_TOKENS || added.length > MAX_ALIGNED_TOKENS) {
    push(segments, 'removed', removed.join(''))
    push(segments, 'added', added.join(''))
  } else {
    for (const segment of align(removed, added)) push(segments, segment.kind, segment.text)
  }

  push(segments, 'unchanged', a.slice(a.length - tail).join(''))
  return segments
}

/**
 * Each word with the whitespace that follows it, so the tokens concatenate back into the string
 * exactly. Carrying the space rather than tokenizing it separately is what keeps "Lake Tahoe" →
 * "Donner Lake" from aligning on the space between the two words and reporting both of them as
 * changed. The second branch catches a leading run of whitespace, which no word precedes.
 */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? []
}

/**
 * Aligns two token runs on their longest common subsequence, so the words that survived stay
 * `unchanged` and only the rest is reported as having left or arrived.
 *
 * `lengths[i][j]` is the LCS length of `a` from `i` and `b` from `j`, filled from the far corner
 * back so the walk forward from the origin can read the better of two futures at every step and
 * emit the diff in document order. Flat and typed rather than nested arrays: the table is the only
 * thing here that grows with the square of the input, so it is the one place worth being careful
 * about.
 */
function align(a: string[], b: string[]): DiffSegment[] {
  const cols = b.length + 1
  const lengths = new Int32Array((a.length + 1) * cols)

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * cols + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * cols + j + 1]! + 1
          : Math.max(lengths[(i + 1) * cols + j]!, lengths[i * cols + j + 1]!)
    }
  }

  const segments: DiffSegment[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(segments, 'unchanged', a[i]!)
      i++
      j++
    } else if (lengths[(i + 1) * cols + j]! >= lengths[i * cols + j + 1]!) {
      // Ties go to the removal, so a replaced word reads as the old wording struck and the new
      // wording added after it, the way a correction is written on paper.
      push(segments, 'removed', a[i]!)
      i++
    } else {
      push(segments, 'added', b[j]!)
      j++
    }
  }

  while (i < a.length) push(segments, 'removed', a[i++]!)
  while (j < b.length) push(segments, 'added', b[j++]!)

  return segments
}

/** Appends text, extending the previous segment when it is of the same kind. */
function push(segments: DiffSegment[], kind: DiffKind, text: string): void {
  if (text === '') return

  const last = segments[segments.length - 1]
  if (last?.kind === kind) last.text += text
  else segments.push({ kind, text })
}
