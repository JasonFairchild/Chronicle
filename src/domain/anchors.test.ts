import { describe, expect, it } from 'vitest'
import {
  anchorRangeOverlapping,
  anchorRefsFor,
  anchorsPlacedSince,
  collectAnchors,
  innermostAnchorAt,
  pairableAnchorAt,
  relationTypeForAnchors,
  resolveAnchors,
  sessionAnchorIds,
  type AnchorRange,
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

describe('sessionAnchorIds', () => {
  const marked = doc('The meeting went badly', {
    anchorId: 'a1',
    kind: 'comment',
    from: 4,
    to: 11,
  })

  it('reports the ids present now that are not sealed', () => {
    expect(sessionAnchorIds(new Set(), marked)).toEqual(['a1'])
  })

  it('drops back out once undone, since it reads the document rather than tallying', () => {
    expect(sessionAnchorIds(new Set(['a1']), doc('The meeting went badly'))).toEqual([])
  })

  it('leaves out an anchor an earlier child sealed into the same document', () => {
    expect(sessionAnchorIds(new Set(['a1']), marked)).toEqual([])
  })
})

describe('anchorsPlacedSince', () => {
  const base = doc('The meeting went badly')
  const marked = doc('The meeting went badly', {
    anchorId: 'a1',
    kind: 'comment',
    from: 4,
    to: 11,
  })

  it('reports what appeared since the session’s base document', () => {
    expect(anchorsPlacedSince(base, marked)).toEqual(['a1'])
  })

  it('reports nothing for an anchor the base already carried', () => {
    // An earlier child's, sealed before this session opened.
    expect(anchorsPlacedSince(marked, marked)).toEqual([])
  })

  it('keeps reporting an anchor placed before a reload, since the base does not move', () => {
    // A resumed draft mounts from `parent_content` — which already carries the anchor placed
    // before the reload — but is measured against the base it started from, where it is absent.
    expect(anchorsPlacedSince(base, marked)).toEqual(['a1'])
  })

  it('treats a target with no parent document at all as having placed nothing', () => {
    expect(anchorsPlacedSince(null, null)).toEqual([])
    expect(anchorsPlacedSince(null, marked)).toEqual(['a1'])
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

  it('pairs with an anchor mark not in the sealed set', () => {
    expect(pairableAnchorAt(mark('a1'), new Set())).toBe('a1')
  })

  it('refuses to pair with a sealed anchor from an earlier child', () => {
    expect(pairableAnchorAt(mark('a1'), new Set(['a1']))).toBeNull()
  })

  it('returns null when the text before the caret carries no anchor mark at all', () => {
    expect(pairableAnchorAt([], new Set())).toBeNull()
    expect(pairableAnchorAt([{ type: 'bold' }], new Set())).toBeNull()
  })
})

describe('innermostAnchorAt', () => {
  const range = (anchor_id: string, from: number, to: number): AnchorRange => ({
    anchor_id,
    from,
    to,
  })

  it('picks the smaller of two overlapping ranges', () => {
    const ranges = [range('outer', 0, 20), range('inner', 5, 10)]

    expect(innermostAnchorAt(ranges, 7)?.anchor_id).toBe('inner')
  })

  it('matches a position sitting exactly on an edge', () => {
    const ranges = [range('a1', 5, 10)]

    expect(innermostAnchorAt(ranges, 5)?.anchor_id).toBe('a1')
    expect(innermostAnchorAt(ranges, 10)?.anchor_id).toBe('a1')
  })

  it('returns null when nothing covers the position', () => {
    expect(innermostAnchorAt([range('a1', 5, 10)], 20)).toBeNull()
  })
})

describe('anchorRangeOverlapping', () => {
  const ranges: AnchorRange[] = [{ anchor_id: 'a1', from: 10, to: 20 }]

  it('returns null for a range that touches nothing', () => {
    expect(anchorRangeOverlapping(ranges, 0, 5)).toBeNull()
    expect(anchorRangeOverlapping(ranges, 25, 30)).toBeNull()
  })

  it('returns null for a range that only touches an edge with no space between', () => {
    expect(anchorRangeOverlapping(ranges, 0, 10)).toBeNull()
    expect(anchorRangeOverlapping(ranges, 20, 30)).toBeNull()
  })

  it('finds a range a selection only partly overlaps', () => {
    expect(anchorRangeOverlapping(ranges, 15, 25)?.anchor_id).toBe('a1')
    expect(anchorRangeOverlapping(ranges, 5, 15)?.anchor_id).toBe('a1')
  })

  it('finds a range that swallows the selection entirely', () => {
    expect(anchorRangeOverlapping(ranges, 12, 18)?.anchor_id).toBe('a1')
  })

  it('finds a range the selection exactly matches', () => {
    expect(anchorRangeOverlapping(ranges, 10, 20)?.anchor_id).toBe('a1')
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
