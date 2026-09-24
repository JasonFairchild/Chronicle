import { describe, expect, it } from 'vitest'
import { Transform } from '@tiptap/pm/transform'
import { plainTextDocument, serializeDocument } from '@/domain/entryDocument'
import { documentsAt, replayDocument, type ReplayLog } from '@/editor/replay'
import type { AuthoringEvent } from '@/types/entry'

const base = serializeDocument(plainTextDocument('It rained'))

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

function typeAt(pos: number, text: string) {
  return (transform: Transform) => transform.insert(pos, transform.doc.type.schema.text(text))
}

describe('documentsAt', () => {
  it('rebuilds the document at each index asked for, in one pass', () => {
    const log = record(typeAt(10, ' all'), typeAt(14, ' day'), typeAt(18, '.'))
    log.events.splice(2, 0, { kind: 'manual', at: 1 })

    expect(documentsAt(log, [0, 2, 3, 4])).toEqual([
      plainTextDocument('It rained'),
      plainTextDocument('It rained all day'),
      plainTextDocument('It rained all day'),
      plainTextDocument('It rained all day.'),
    ])
  })

  it('stops at a step that no longer applies, keeping what it reached', () => {
    const log = record(typeAt(10, ' all'), typeAt(14, ' day'))
    log.events[1] = { kind: 'edit', at: 1, steps: [{ stepType: 'replace', from: 900, to: 900 }] }

    expect(documentsAt(log, [1, 2])).toEqual([plainTextDocument('It rained all')])
  })
})
