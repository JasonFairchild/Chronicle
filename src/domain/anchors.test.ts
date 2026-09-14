import { describe, expect, it } from 'vitest'
import {
  addedAnchorIds,
  anchorRefsFor,
  collectAnchors,
  pairableAnchorAt,
  relationTypeForAnchors,
  resolveAnchors,
} from '@/domain/anchors'
import { serializeDocument, type DocMark, type EntryDocument } from '@/domain/entryDocument'

/** A one-paragraph document, with a subrange optionally carrying an anchor mark. */
function doc(text: string, mark?: { anchorId: string; kind: string; from: number; to: number }) {
  if (!mark) {
    return serializeDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
  }

  const nodes = [
    { type: 'text', text: text.slice(0, mark.from) },
    {
      type: 'text',
      text: text.slice(mark.from, mark.to),
      marks: [{ type: 'anchor', attrs: { anchorId: mark.anchorId, kind: mark.kind } }],
    },
    { type: 'text', text: text.slice(mark.to) },
  ].filter((node) => node.text !== '')

  return serializeDocument({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] })
}

/** A document with one bare `anchorInsert` node at the given index. */
function docWithInsert(text: string, anchorId: string, at: number, insertedText: string): string {
  const before = text.slice(0, at)
  const after = text.slice(at)

  return serializeDocument({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          ...(before ? [{ type: 'text', text: before }] : []),
          { type: 'anchorInsert', attrs: { anchorId, text: insertedText } },
          ...(after ? [{ type: 'text', text: after }] : []),
        ],
      },
    ],
  } satisfies EntryDocument)
}

describe('collectAnchors', () => {
  it('reads a mark as one anchor with its covered text as the quote', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    const anchors = collectAnchors(content)

    expect(anchors).toEqual([
      { anchor_id: 'a1', kind: 'comment', quote: 'meeting', insertion: null },
    ])
  })

  it('folds a mark and an anchorInsert sharing one id into a single anchor', () => {
    const content = serializeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Wrong ' },
            {
              type: 'text',
              text: 'lake',
              marks: [{ type: 'anchor', attrs: { anchorId: 'a1', kind: 'strike' } }],
            },
            { type: 'anchorInsert', attrs: { anchorId: 'a1', text: 'Donner Lake' } },
          ],
        },
      ],
    })

    const anchors = collectAnchors(content)

    expect(anchors).toEqual([
      { anchor_id: 'a1', kind: 'strike', quote: 'lake', insertion: 'Donner Lake' },
    ])
  })

  it('reads a bare anchorInsert as an anchor with no mark', () => {
    const content = docWithInsert('I went home', 'a1', 2, 'later')

    expect(collectAnchors(content)).toEqual([
      { anchor_id: 'a1', kind: null, quote: '', insertion: 'later' },
    ])
  })

  it('returns nothing for a document with no anchors', () => {
    expect(collectAnchors(doc('Plain text'))).toEqual([])
  })
})

describe('addedAnchorIds', () => {
  it('reports only the ids that appeared since the earlier document', () => {
    const before = doc('The meeting went badly')
    const after = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    expect(addedAnchorIds(before, after)).toEqual(['a1'])
  })

  it('drops back out once undone, since it diffs the documents rather than tallying', () => {
    const before = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    expect(addedAnchorIds(before, before)).toEqual([])
  })
})

describe('anchorRefsFor', () => {
  it('captures the quote each requested id currently covers', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    expect(anchorRefsFor(['a1'], content)).toEqual([{ anchor_id: 'a1', quote: 'meeting' }])
  })

  it('skips an id the document does not carry, since it was undone before sealing', () => {
    const content = doc('The meeting went badly')

    expect(anchorRefsFor(['a1'], content)).toEqual([])
  })
})

describe('resolveAnchors', () => {
  it('reads the anchor’s current wording from the document, not the stored quote', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })
    const refs = [{ anchor_id: 'a1', quote: 'meeting' }]

    expect(resolveAnchors(refs, content)).toEqual([
      { anchor_id: 'a1', status: 'present', quote: 'meeting', kind: 'comment', insertion: null },
    ])
  })

  it('falls back to the stored quote once a revision removes the mark', () => {
    const refs = [{ anchor_id: 'a1', quote: 'meeting' }]

    expect(resolveAnchors(refs, doc('Rewritten entirely'))).toEqual([
      { anchor_id: 'a1', status: 'orphaned', quote: 'meeting', kind: null, insertion: null },
    ])
  })
})

describe('pairableAnchorAt', () => {
  const mark = (anchorId: string, kind = 'comment'): DocMark[] => [
    { type: 'anchor', attrs: { anchorId, kind } },
  ]

  it('pairs with an anchor mark placed this session', () => {
    const before = doc('The meeting went badly')
    const after = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    expect(pairableAnchorAt(mark('a1'), after, before)).toBe('a1')
  })

  it('refuses to pair with a sealed anchor from an earlier child', () => {
    const sealed = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    // The anchor is present in *both* documents — this session never placed it.
    expect(pairableAnchorAt(mark('a1'), sealed, sealed)).toBeNull()
  })

  it('returns null when the text before the caret carries no anchor mark at all', () => {
    const before = doc('Plain text')
    const after = doc('Plain text')

    expect(pairableAnchorAt([], after, before)).toBeNull()
    expect(pairableAnchorAt([{ type: 'bold' }], after, before)).toBeNull()
  })
})

describe('relationTypeForAnchors', () => {
  it('reads commenting on a passage as an annotation, since nothing was corrected', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    expect(relationTypeForAnchors(['a1'], content)).toBe('annotation')
  })

  it('reads a strike as an update, since striking reports a correction', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'strike',
      from: 4,
      to: 11,
    })

    expect(relationTypeForAnchors(['a1'], content)).toBe('update')
  })

  it('reads proposed wording with nothing struck as an update too', () => {
    const content = docWithInsert('The meeting went badly', 'a1', 22, ' in the end')

    expect(relationTypeForAnchors(['a1'], content)).toBe('update')
  })

  it('takes one correction among comments as enough to make the whole note an update', () => {
    const content = serializeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The ',
              marks: [{ type: 'anchor', attrs: { anchorId: 'a1', kind: 'comment' } }],
            },
            {
              type: 'text',
              text: 'meeting',
              marks: [{ type: 'anchor', attrs: { anchorId: 'a2', kind: 'strike' } }],
            },
          ],
        },
      ],
    })

    expect(relationTypeForAnchors(['a1', 'a2'], content)).toBe('update')
  })

  it('calls a note with nothing anchored an annotation, the quieter claim', () => {
    expect(relationTypeForAnchors([], doc('Untouched'))).toBe('annotation')
  })

  it('ignores an id the document no longer carries, such as one undone before sealing', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'strike',
      from: 4,
      to: 11,
    })

    expect(relationTypeForAnchors(['gone'], content)).toBe('annotation')
  })
})
