import { describe, expect, it } from 'vitest'

import { ANCHOR_MARK, ANCHOR_WORDING_MARK } from '@/domain/entryDocument'
import { anchorIndex } from '@/editor/anchorIndex'
import { replayDocument } from '@/editor/replay'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { serializeDocument } from '@/testing/documents'

describe('anchorIndex', () => {
  it('spans a passage and its wording as one anchor, each piece with its mark', () => {
    // "It " 1–4, "rained" 4–10 (the passage), "heavily" 10–17 (its wording), " all day" 17–25.
    const doc = replayDocument(withAnchorWording('It rained all day', 'a1', 3, 9, 'heavily'))!

    expect(anchorIndex(doc).get('a1')).toMatchObject({
      anchorId: 'a1',
      from: 4,
      to: 17,
      kind: 'comment',
      passage: [
        {
          from: 4,
          to: 10,
          mark: { type: { name: ANCHOR_MARK }, attrs: { anchorId: 'a1', kind: 'comment' } },
        },
      ],
      wording: [
        {
          from: 10,
          to: 17,
          mark: { type: { name: ANCHOR_WORDING_MARK }, attrs: { anchorId: 'a1' } },
        },
      ],
    })
  })

  it('reads wording with no passage as an anchor with no kind', () => {
    const doc = replayDocument(withAnchorWording('I went home', 'a1', 2, 2, 'later'))!

    expect(anchorIndex(doc).get('a1')).toMatchObject({
      from: 3,
      to: 8,
      kind: null,
      passage: [],
      wording: [{ from: 3, to: 8 }],
    })
  })

  it('lists anchors in document order, not by id', () => {
    const doc = replayDocument(
      serializeDocument({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Once',
                marks: [{ type: ANCHOR_MARK, attrs: { anchorId: 'b', kind: 'strike' } }],
              },
              { type: 'text', text: ' upon ' },
              {
                type: 'text',
                text: 'a time',
                marks: [{ type: ANCHOR_WORDING_MARK, attrs: { anchorId: 'a' } }],
              },
            ],
          },
        ],
      }),
    )!

    expect([...anchorIndex(doc).keys()]).toEqual(['b', 'a'])
  })

  it('returns the same index for the same document', () => {
    const doc = replayDocument(withAnchorWording('Twice told', 'a1', 0, 5, ''))!

    expect(anchorIndex(doc)).toBe(anchorIndex(doc))
  })
})
