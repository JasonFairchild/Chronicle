import { describe, expect, it } from 'vitest'

import {
  type AnchorRange,
  anchorRangeOverlapping,
  anchorRefsFor,
  anchorsPlacedSince,
  collectAnchors,
  relationTypeForAnchors,
  resolveAnchors,
} from '@/domain/anchors'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { serializeDocument } from '@/testing/documents'

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

  it('folds a passage and the wording marked after it into a single anchor', () => {
    const content = withAnchorWording('Wrong lake', 'a1', 6, 10, 'Donner Lake', 'strike')

    expect(collectAnchors(content)).toEqual([
      { anchor_id: 'a1', kind: 'strike', quote: 'lake', insertion: 'Donner Lake' },
    ])
  })

  it('reads marked wording with no passage as a bare insertion', () => {
    const content = withAnchorWording('I went home', 'a1', 2, 2, 'later')

    expect(collectAnchors(content)).toEqual([
      { anchor_id: 'a1', kind: null, quote: '', insertion: 'later' },
    ])
  })

  it('reads marked wording as written, so a typed space is a correction', () => {
    const content = withAnchorWording('I wentalone', 'a1', 6, 6, ' ')

    expect(collectAnchors(content)[0]?.insertion).toBe(' ')
  })

  it('returns nothing for a document with no anchors', () => {
    expect(collectAnchors(doc('Plain text'))).toEqual([])
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
    // An earlier related entry's, sealed before this session opened.
    expect(anchorsPlacedSince(marked, marked)).toEqual([])
  })

  it('keeps reporting an anchor placed before a reload, since the base does not move', () => {
    // A resumed draft mounts from `Draft.parent.content` — which already carries the anchor placed
    // before the reload — but is measured against the base it started from, where it is absent.
    expect(anchorsPlacedSince(base, marked)).toEqual(['a1'])
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
    const content = withAnchorWording('The meeting went badly', 'a1', 22, 22, ' in the end')

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
