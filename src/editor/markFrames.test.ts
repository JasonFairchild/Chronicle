import { describe, expect, it } from 'vitest'
import { Transform } from '@tiptap/pm/transform'
import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  plainTextDocument,
  serializeDocument,
} from '@/domain/entryDocument'
import type { AuthoringMark } from '@/domain/marks'
import { buildFrames, documentsFromFrames } from '@/editor/markFrames'
import { documentsAt, replayDocument, type ReplayLog } from '@/editor/replay'
import type { AuthoringEvent } from '@/types/entry'

// "rained" is 4–10, "all" 11–14, "day" 15–18.
const base = serializeDocument(plainTextDocument('It rained all day'))

/** A log of one edit per operation, the way the editor emits one per transaction. */
function record(...operations: ((transform: Transform) => void)[]): ReplayLog {
  let doc = replayDocument(base)!
  const events = operations.map((operate, i): AuthoringEvent => {
    const transform = new Transform(doc)
    operate(transform)
    doc = transform.doc
    return { kind: 'edit', at: i, steps: transform.steps.map((step) => step.toJSON()) }
  })

  return { base_content: base, events }
}

/** A mark after each of `indices` events. Frames don't read the reasons. */
function marksAt(...indices: number[]): AuthoringMark[] {
  return indices.map((index) => ({ at: index, index, reasons: ['manual'] }))
}

function typeAt(pos: number, text: string) {
  return (transform: Transform) => transform.insert(pos, transform.doc.type.schema.text(text))
}

function deleteRange(from: number, to: number) {
  return (transform: Transform) => transform.delete(from, to)
}

function bold(from: number, to: number) {
  return (transform: Transform) =>
    transform.addMark(from, to, transform.doc.type.schema.marks.bold.create())
}

describe('buildFrames', () => {
  it('rebuilds each marked document from the frames alone, as the raw replay does', () => {
    const log = record(
      typeAt(18, ','),
      typeAt(19, ' then'),
      deleteRange(4, 11),
      bold(1, 3),
      typeAt(1, 'Oh. '),
    )
    const frames = buildFrames(log, marksAt(2, 4, 5))

    expect(documentsFromFrames({ base_content: base, frames })).toEqual(documentsAt(log, [2, 4, 5]))
  })

  it('stores a burst of typing as one net step, not one per keystroke', () => {
    const log = record(...[...' and night'].map((char, i) => typeAt(18 + i, char)))

    const [frame] = buildFrames(log, marksAt(log.events.length))

    expect(frame?.net).toMatchObject({ steps: [{ stepType: 'replace', from: 18, to: 18 }] })
  })

  it('stores the whole document when the net step fails its check', () => {
    const log = record(typeAt(18, '.'))

    const frames = buildFrames(log, marksAt(1), () => false)

    expect(frames[0]?.net).toEqual({ document: documentsAt(log, [1])[0] })
    expect(documentsFromFrames({ base_content: base, frames })).toEqual(documentsAt(log, [1]))
  })

  it('highlights exactly the text a frame added', () => {
    const [frame] = buildFrames(record(typeAt(18, ' and night')), marksAt(1))

    expect(frame?.changes).toEqual([{ kind: 'added', from: 18, to: 28 }])
  })

  it('carries the text a frame removed, to show struck where it was', () => {
    const [frame] = buildFrames(record(deleteRange(4, 11)), marksAt(1))

    expect(frame?.changes).toEqual([{ kind: 'removed', from: 4, to: 4, removed: 'rained ' }])
  })

  it('leaves out text typed and deleted again before the mark', () => {
    const [frame] = buildFrames(record(typeAt(18, ' and night'), deleteRange(22, 28)), marksAt(2))

    expect(frame?.changes).toEqual([{ kind: 'added', from: 18, to: 22 }])
  })

  it('highlights formatting where it was applied', () => {
    const [frame] = buildFrames(record(bold(4, 10)), marksAt(1))

    expect(frame?.changes).toEqual([{ kind: 'formatted', from: 4, to: 10 }])
  })

  it('highlights an anchor over its marked text and its wording as one', () => {
    const placeAnchor = (transform: Transform) => {
      const { schema } = transform.doc.type
      transform.addMark(4, 10, schema.marks[ANCHOR_MARK].create({ anchorId: 'a-1' }))
      transform.insert(10, schema.nodes[ANCHOR_INSERT_NODE].create({ anchorId: 'a-1' }))
    }

    const [frame] = buildFrames(record(placeAnchor), marksAt(1))

    expect(frame?.changes).toEqual([{ kind: 'anchor', from: 4, to: 11 }])
  })

  it('moves a highlight along with a later edit earlier in the document', () => {
    const [frame] = buildFrames(record(bold(15, 18), typeAt(1, 'Oh, ')), marksAt(2))

    expect(frame?.changes).toEqual([
      { kind: 'added', from: 1, to: 5 },
      { kind: 'formatted', from: 19, to: 22 },
    ])
  })
})
