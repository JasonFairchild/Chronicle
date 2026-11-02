import type { Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'

import { contentDelta, type EntryDocument } from '@/domain/entryDocument'
import type { ChangeSignals } from '@/types/entry'

import { readAnchorWordingText } from './anchorCommands'

// The signals of one editor change (AUTHORING.md, "Authoring capture"). In the editor layer because
// they read ProseMirror steps; pure, so a bare `EditorState` proves them without mounting anything.

/** The text a change added, for the mark policy's punctuation and pattern checks. */
function insertedTextOf(transaction: Transaction): string {
  let inserted = ''

  for (const step of transaction.steps) {
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      inserted += step.slice.content.textBetween(0, step.slice.content.size, '')
    }
  }

  return inserted
}

/**
 * Characters this change removed, measured against the document each step saw before it applied
 * rather than by comparing text before and after: a selection replaced by something longer would
 * net positive, missing the deletion it was.
 *
 * A `ReplaceAroundStep` is skipped: wrapping a paragraph in a list spans the whole block and puts its
 * content back through the gap, so its range would count the paragraph as deleted.
 */
function removedTextOf(transaction: Transaction): number {
  let removed = 0

  transaction.steps.forEach((step, i) => {
    if (step instanceof ReplaceStep) {
      removed += transaction.docs[i]!.textBetween(step.from, step.to, '').length
    }
  })

  return removed
}

/**
 * The signals of `transaction`, given the document as it stands after it and anything appended.
 *
 * Formatting and anchor ops are judged by outcome, comparing the documents (`contentDelta`), since
 * no step type tells a heading, a list or an anchor command apart from a real edit. That also
 * carries `is_anchor_op` through undo and redo, whose transactions have no meta of their own.
 */
export function changeSignals(transaction: Transaction, after: EntryDocument): ChangeSignals {
  const delta = contentDelta(transaction.before.toJSON() as EntryDocument, after)
  // A wording-box keystroke looks like formatting by outcome, since wording is in none of the
  // three comparisons, and its attribute step has no slice to read text from.
  const wordingText = readAnchorWordingText(transaction)

  return {
    // The box's whole text serves: the punctuation check reads only its last character.
    inserted_text: wordingText ?? insertedTextOf(transaction),
    removed_chars: removedTextOf(transaction),
    is_formatting: delta.sameText && delta.sameMedia && delta.sameAnchors && wordingText === null,
    is_anchor_op: !delta.sameAnchors,
    // ProseMirror stamps this on its own paste handling. A drop is `'drop'` (PRODUCT.md §4.10), and
    // content inserted by a command, as an attached image is, carries none.
    is_paste: transaction.getMeta('uiEvent') === 'paste',
    media_changed: !delta.sameMedia,
  }
}
