import { EditorState, type Transaction } from '@tiptap/pm/state'
import { findWrapping } from '@tiptap/pm/transform'
import { describe, expect, it } from 'vitest'

import {
  ANCHOR_MARK,
  ANCHOR_WORDING_MARK,
  type EntryDocument,
  MEDIA_NODE,
} from '@/domain/entryDocument'
import { changeSignals } from '@/editor/changeSignals'
import { replayDocument } from '@/editor/replay'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { plainTextDocument } from '@/testing/documents'
import type { ChangeSignals } from '@/types/entry'

/** "rained" is 4–10, "all" 11–14, "day" 15–18. */
function startingTransaction(): Transaction {
  return EditorState.create({ doc: replayDocument(plainTextDocument('It rained all day'))! }).tr
}

function signalsOf(transaction: Transaction): ChangeSignals {
  return changeSignals(transaction, transaction.doc.toJSON() as EntryDocument)
}

const noSignals: ChangeSignals = {
  inserted_text: '',
  removed_chars: 0,
  is_formatting: false,
  is_anchor_op: false,
  is_paste: false,
  media_changed: false,
}

describe('changeSignals', () => {
  it('reports typed text', () => {
    const transaction = startingTransaction().insertText(' and night', 18)

    expect(signalsOf(transaction)).toEqual({ ...noSignals, inserted_text: ' and night' })
  })

  it('counts the removal when a selection is replaced by longer text', () => {
    const transaction = startingTransaction().insertText('poured down', 4, 10)

    expect(signalsOf(transaction)).toEqual({
      ...noSignals,
      inserted_text: 'poured down',
      removed_chars: 6,
    })
  })

  it('reports wrapping a paragraph in a list as formatting, with nothing removed', () => {
    const transaction = startingTransaction()
    const { schema } = transaction.doc.type
    const range = transaction.doc.resolve(1).blockRange()!
    transaction.wrap(range, findWrapping(range, schema.nodes.bulletList!)!)

    expect(signalsOf(transaction)).toEqual({ ...noSignals, is_formatting: true })
  })

  it('reports bold as formatting', () => {
    const transaction = startingTransaction()
    transaction.addMark(4, 10, transaction.doc.type.schema.marks.bold!.create())

    expect(signalsOf(transaction)).toEqual({ ...noSignals, is_formatting: true })
  })

  it('reports a heading as formatting', () => {
    const transaction = startingTransaction()
    transaction.setBlockType(1, 1, transaction.doc.type.schema.nodes.heading!, { level: 2 })

    expect(signalsOf(transaction)).toEqual({ ...noSignals, is_formatting: true })
  })

  it('reports a paste by its meta', () => {
    const transaction = startingTransaction().insertText(' Copied', 18).setMeta('uiEvent', 'paste')

    expect(signalsOf(transaction)).toEqual({
      ...noSignals,
      inserted_text: ' Copied',
      is_paste: true,
    })
  })

  it('does not count a drop as a paste', () => {
    const transaction = startingTransaction().insertText(' Dropped', 18).setMeta('uiEvent', 'drop')

    expect(signalsOf(transaction)).toEqual({ ...noSignals, inserted_text: ' Dropped' })
  })

  it('reports an attached image as a media change, not formatting', () => {
    const transaction = startingTransaction()
    const image = transaction.doc.type.schema.nodes[MEDIA_NODE]!.create({ mediaRef: 'media-1' })
    transaction.insert(transaction.doc.content.size, image)

    expect(signalsOf(transaction)).toEqual({ ...noSignals, media_changed: true })
  })

  it('reports an anchor mark as an anchor op, not formatting', () => {
    const transaction = startingTransaction()
    const anchor = transaction.doc.type.schema.marks[ANCHOR_MARK]!.create({
      anchorId: 'anchor-1',
      kind: 'comment',
    })
    transaction.addMark(4, 10, anchor)

    expect(signalsOf(transaction)).toEqual({ ...noSignals, is_anchor_op: true })
  })

  it('reports a space typed into wording as typing, not formatting', () => {
    // "rained" is the passage, and "heavily" its wording at 10–17.
    const content = withAnchorWording('It rained all day', 'anchor-1', 3, 9, 'heavily')
    const transaction = EditorState.create({ doc: replayDocument(content)! }).tr
    const { schema } = transaction.doc.type
    const wording = schema.marks[ANCHOR_WORDING_MARK]!.create({ anchorId: 'anchor-1' })
    transaction.insert(17, schema.text(' ', [wording]))

    expect(signalsOf(transaction)).toEqual({ ...noSignals, inserted_text: ' ' })
  })
})
