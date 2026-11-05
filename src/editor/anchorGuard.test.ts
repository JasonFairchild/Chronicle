import { history, undo } from '@tiptap/pm/history'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { ANCHOR_MARK, ANCHOR_WORDING_MARK } from '@/domain/entryDocument'
import { ANCHOR_EDIT_META } from '@/editor/anchorCommands'
import { allowsEdit, sealAnchors, type SealedAnchors } from '@/editor/anchorGuard'
import { replayDocument } from '@/editor/replay'
import { withAnchorWording } from '@/testing/anchorFixtures'

/** "It " 1–4, "rained" 4–10 (the passage), "heavily" 10–17 (its wording), " all day" 17–25. */
function startingState(): EditorState {
  const content = withAnchorWording('It rained all day', 'anchor-1', 3, 9, 'heavily')
  return EditorState.create({ doc: replayDocument(content)!, plugins: [history()] })
}

function startingTransaction(): Transaction {
  return startingState().tr
}

/** The starting document's anchor sealed, as a revision or an earlier related entry has it. */
const anchorSealed = sealAnchors(startingState().doc)
/** Nothing sealed, so in anchor mode the starting document's anchor is the session's own. */
const noneSealed: SealedAnchors = new Map()

describe('allowsEdit', () => {
  describe('outside anchor mode', () => {
    it('lets the parent’s own words change', () => {
      const transaction = startingTransaction().insertText('every', 18, 21)

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(true)
    })

    it('lets formatting through away from an anchor', () => {
      const transaction = startingTransaction()
      transaction.addMark(18, 21, transaction.doc.type.schema.marks.bold!.create())

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(true)
    })

    it.each([
      ['start', 4],
      ['end', 17],
    ] as const)('lets typing against an anchor’s %s through', (_edge, at) => {
      const transaction = startingTransaction().insertText('x', at)

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(true)
    })

    it.each([
      ['its passage', 7],
      ['its wording', 13],
      ['between them', 10],
    ] as const)('refuses typing inside an anchor: %s', (_where, at) => {
      const transaction = startingTransaction().insertText('x', at)

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(false)
    })

    it.each([
      ['part of an anchor', 12, 14],
      ['all of its wording', 10, 17],
      ['a whole anchor and more', 4, 21],
    ] as const)('refuses deleting %s', (_what, from, to) => {
      const transaction = startingTransaction().delete(from, to)

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(false)
    })

    it('refuses bold across an anchor', () => {
      const transaction = startingTransaction()
      transaction.addMark(1, 25, transaction.doc.type.schema.marks.bold!.create())

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(false)
    })

    it('refuses a heading across an anchor', () => {
      const transaction = startingTransaction()
      transaction.setBlockType(1, 1, transaction.doc.type.schema.nodes.heading!, { level: 2 })

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(false)
    })

    it.each([
      ['wording', ANCHOR_WORDING_MARK],
      ['passage', ANCHOR_MARK],
    ] as const)('refuses removing an anchor’s %s mark', (_piece, mark) => {
      const transaction = startingTransaction()
      transaction.removeMark(1, 25, transaction.doc.type.schema.marks[mark]!)

      expect(allowsEdit(transaction, anchorSealed, false)).toBe(false)
    })
  })

  describe('in anchor mode', () => {
    it('lets a selection change through', () => {
      const transaction = startingTransaction()
      transaction.setSelection(TextSelection.create(transaction.doc, 5, 8))

      expect(allowsEdit(transaction, noneSealed, true)).toBe(true)
    })

    it('lets typing inside the session’s own wording through', () => {
      const transaction = startingTransaction().insertText('x', 13)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(true)
    })

    it('lets replacing the session’s own wording through', () => {
      const transaction = startingTransaction().insertText('lightly', 10, 17)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(true)
    })

    it('lets deleting part of the session’s own wording through', () => {
      const transaction = startingTransaction().delete(12, 14)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(true)
    })

    it('lets typing at a bare caret through', () => {
      const transaction = startingTransaction().insertText('x', 21)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(true)
    })

    it.each([
      ['the parent’s words', 18, 21],
      ['its own passage', 5, 7],
    ] as const)('refuses deleting %s', (_what, from, to) => {
      const transaction = startingTransaction().delete(from, to)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(false)
    })

    it('refuses replacing a selection that runs past its own wording', () => {
      const transaction = startingTransaction().insertText('x', 15, 20)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(false)
    })

    it('refuses a paragraph split, even inside its own wording', () => {
      const transaction = startingTransaction().split(13)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(false)
    })

    it('refuses a hard break, even inside its own wording', () => {
      const transaction = startingTransaction()
      transaction.insert(13, transaction.doc.type.schema.nodes.hardBreak!.create())

      expect(allowsEdit(transaction, noneSealed, true)).toBe(false)
    })

    it('refuses formatting', () => {
      const transaction = startingTransaction()
      transaction.addMark(18, 21, transaction.doc.type.schema.marks.bold!.create())

      expect(allowsEdit(transaction, noneSealed, true)).toBe(false)
    })

    it.each([
      ['passage', 7],
      ['wording', 13],
    ] as const)('refuses typing inside a sealed anchor’s %s', (_piece, at) => {
      const transaction = startingTransaction().insertText('x', at)

      expect(allowsEdit(transaction, anchorSealed, true)).toBe(false)
    })

    it('lets an anchor command through', () => {
      const transaction = startingTransaction()
      const passage = transaction.doc.type.schema.marks[ANCHOR_MARK]!.create({
        anchorId: 'anchor-2',
        kind: 'comment',
      })
      transaction.addMark(18, 21, passage).setMeta(ANCHOR_EDIT_META, true)

      expect(allowsEdit(transaction, noneSealed, true)).toBe(true)
    })

    it('refuses an anchor command that changes a sealed anchor', () => {
      const transaction = startingTransaction()
      transaction
        .removeMark(1, 25, transaction.doc.type.schema.marks[ANCHOR_MARK]!)
        .setMeta(ANCHOR_EDIT_META, true)

      expect(allowsEdit(transaction, anchorSealed, true)).toBe(false)
    })

    it('lets undo through, of an anchor command too', () => {
      let state = startingState()
      const passage = state.schema.marks[ANCHOR_MARK]!.create({
        anchorId: 'anchor-2',
        kind: 'comment',
      })
      state = state.apply(state.tr.addMark(18, 21, passage).setMeta(ANCHOR_EDIT_META, true))
      let undone: Transaction | undefined
      undo(state, (transaction) => (undone = transaction))

      expect(allowsEdit(undone!, noneSealed, true)).toBe(true)
    })
  })
})
