import { describe, expect, it } from 'vitest'

import { anchorsPlacedSince, collectAnchors, relationTypeForAnchors } from '@/domain/anchors'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { serializeDocument } from '@/testing/documents'
import type { DocumentAnchor } from '@/types/entry'

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
  it('reads a mark as one anchor with its covered text as the passage', () => {
    const content = doc('The meeting went badly', {
      anchorId: 'a1',
      kind: 'comment',
      from: 4,
      to: 11,
    })

    const anchors = collectAnchors(content)

    expect(anchors).toEqual([
      { anchor_id: 'a1', kind: 'comment', passage: 'meeting', wording: null },
    ])
  })

  it('folds a passage and the wording marked after it into a single anchor', () => {
    const content = withAnchorWording('Wrong lake', 'a1', 6, 10, 'Donner Lake', 'strike')

    expect(collectAnchors(content)).toEqual([
      { anchor_id: 'a1', kind: 'strike', passage: 'lake', wording: 'Donner Lake' },
    ])
  })

  it('reads marked wording with no passage as a bare insertion', () => {
    const content = withAnchorWording('I went home', 'a1', 2, 2, 'later')

    expect(collectAnchors(content)).toEqual([
      { anchor_id: 'a1', kind: null, passage: '', wording: 'later' },
    ])
  })

  it('reads marked wording as written, so a typed space is a correction', () => {
    const content = withAnchorWording('I wentalone', 'a1', 6, 6, ' ')

    expect(collectAnchors(content)[0]?.wording).toBe(' ')
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
    expect(anchorsPlacedSince(base, marked)).toEqual([
      { anchor_id: 'a1', kind: 'comment', passage: 'meeting', wording: null },
    ])
  })

  it('reports nothing for an anchor the base already carried', () => {
    // An earlier related entry's, sealed before this session opened.
    expect(anchorsPlacedSince(marked, marked)).toEqual([])
  })
})

describe('relationTypeForAnchors', () => {
  const comment: DocumentAnchor = {
    anchor_id: 'a1',
    kind: 'comment',
    passage: 'The',
    wording: null,
  }
  const strike: DocumentAnchor = {
    anchor_id: 'a2',
    kind: 'strike',
    passage: 'meeting',
    wording: null,
  }

  it('reads commenting on a passage as an annotation, since nothing was corrected', () => {
    expect(relationTypeForAnchors([comment])).toBe('annotation')
  })

  it('reads a strike as an update, since striking reports a correction', () => {
    expect(relationTypeForAnchors([strike])).toBe('update')
  })

  it('reads proposed wording with nothing struck as an update too', () => {
    const wording: DocumentAnchor = {
      anchor_id: 'a3',
      kind: null,
      passage: '',
      wording: ' in the end',
    }

    expect(relationTypeForAnchors([wording])).toBe('update')
  })

  it('takes one correction among comments as enough to make the whole note an update', () => {
    expect(relationTypeForAnchors([comment, strike])).toBe('update')
  })
})
