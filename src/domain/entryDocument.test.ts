import { describe, expect, it } from 'vitest'

import {
  collectMediaRefs,
  contentDelta,
  docToPlainText,
  type EntryDocument,
  isBlankDraft,
  isEmptyDocument,
  parseDocument,
  previewText,
  sameDocument,
} from '@/domain/entryDocument'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { plainTextDocument, serializeDocument } from '@/testing/documents'

const document: EntryDocument = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'We drove up on Friday.' }] },
    { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Snow' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pines' }] }],
        },
      ],
    },
  ],
}

describe('docToPlainText', () => {
  it('flattens the body one line per block', () => {
    expect(docToPlainText(document)).toBe('We drove up on Friday.\n\nSnow\nPines')
  })

  it('reads a serialized document the same whether it came from an object or a string', () => {
    const serialized = serializeDocument(plainTextDocument('First line\nSecond line'))

    expect(docToPlainText(serialized)).toBe('First line\nSecond line')
    expect(docToPlainText(plainTextDocument('First line\nSecond line'))).toBe(
      'First line\nSecond line',
    )
  })

  it('turns a hard break into a line break inside its paragraph', () => {
    const withBreak: EntryDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Roses' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Violets' },
          ],
        },
      ],
    }

    expect(docToPlainText(withBreak)).toBe('Roses\nViolets')
  })

  it('reads wording an anchor proposes as the parent’s text, adding nothing around it', () => {
    const struck = withAnchorWording('It rained all day', 'a1', 3, 9, ' poured', 'strike')

    expect(docToPlainText(struck)).toBe('It rained poured all day')
  })
})

describe('previewText', () => {
  it('collapses the body onto one line', () => {
    expect(previewText(document)).toBe('We drove up on Friday. Snow Pines')
  })

  it('trims to the limit it is given, counting the ellipsis within it', () => {
    const long = plainTextDocument('a'.repeat(200))

    expect(previewText(long, 10)).toBe('aaaaaaa...')
    expect(previewText(plainTextDocument('Short enough'), 60)).toBe('Short enough')
  })

  it('previews an empty document as nothing, leaving the caller to name it', () => {
    expect(previewText(plainTextDocument('   \n  '))).toBe('')
  })

  it('includes wording an anchor proposes', () => {
    const annotated = withAnchorWording('It rained', 'a1', 9, 9, ' all day')

    expect(previewText(annotated)).toBe('It rained all day')
  })
})

describe('collectMediaRefs', () => {
  it('collects every media id once, in document order', () => {
    const twice: EntryDocument = {
      type: 'doc',
      content: [
        { type: 'mediaImage', attrs: { mediaRef: 'blob-2' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Same photo again' }] },
        { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } },
        { type: 'mediaImage', attrs: { mediaRef: 'blob-2' } },
      ],
    }

    expect(collectMediaRefs(twice)).toEqual(['blob-2', 'blob-1'])
    expect(collectMediaRefs(plainTextDocument('Nothing attached'))).toEqual([])
  })
})

describe('isEmptyDocument', () => {
  it('is true only when there is no text and no media', () => {
    expect(isEmptyDocument(plainTextDocument('   \n  '))).toBe(true)
    expect(
      isEmptyDocument({
        type: 'doc',
        content: [{ type: 'mediaImage', attrs: { mediaRef: 'blob-1' } }],
      }),
    ).toBe(false)
  })
})

describe('isBlankDraft', () => {
  it('is rescued from an empty document by a real title, but not by a blank one', () => {
    const blank = plainTextDocument('   \n  ')

    expect(isBlankDraft(blank, null)).toBe(true)
    expect(isBlankDraft(blank, '   ')).toBe(true)
    expect(isBlankDraft(blank, 'Just a title')).toBe(false)
  })
})

describe('parseDocument', () => {
  it('round-trips a document through serialization', () => {
    expect(parseDocument(serializeDocument(document))).toEqual(document)
  })

  it('reads an empty string as a blank document rather than throwing', () => {
    // The transient state of a ref before an editor has mounted or a draft has been typed into —
    // never something stored, since an empty document is refused at save time.
    expect(parseDocument('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('rejects content that is not a real serialized document', () => {
    expect(() => parseDocument('plain prose, never serialized')).toThrow()
    expect(() => parseDocument('{ not valid JSON')).toThrow()
    expect(() => parseDocument(JSON.stringify({ not: 'a document' }))).toThrow()
  })
})

describe('sameDocument', () => {
  const paragraph: EntryDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We drove up on Friday.' }] }],
  }

  it('sees marks and block types', () => {
    const bolded: EntryDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'We drove up on Friday.', marks: [{ type: 'bold' }] }],
        },
      ],
    }
    const asHeading: EntryDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'We drove up on Friday.' }],
        },
      ],
    }

    expect(sameDocument(paragraph, bolded)).toBe(false)
    expect(sameDocument(paragraph, asHeading)).toBe(false)
  })

  it('ignores the empty block the editor keeps at the end of a document', () => {
    const withTrailingBlock: EntryDocument = {
      type: 'doc',
      content: [...paragraph.content, { type: 'paragraph' }],
    }

    expect(sameDocument(paragraph, withTrailingBlock)).toBe(true)
  })

  it('compares a serialized document and a live one identically', () => {
    expect(sameDocument(serializeDocument(paragraph), paragraph)).toBe(true)
  })
})

describe('contentDelta', () => {
  const paragraph: EntryDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We drove up on Friday.' }] }],
  }

  it('reports a document whose only change was a mark as the same text and the same media', () => {
    const bolded: EntryDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'We drove up on Friday.', marks: [{ type: 'bold' }] }],
        },
      ],
    }

    const delta = contentDelta(paragraph, bolded)
    expect(delta.sameText).toBe(true)
    expect(delta.sameMedia).toBe(true)
  })

  it('reports an attached image as the same text but different media', () => {
    const withImage: EntryDocument = {
      type: 'doc',
      content: [...paragraph.content, { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } }],
    }

    const delta = contentDelta(paragraph, withImage)
    expect(delta.sameText).toBe(true)
    expect(delta.sameMedia).toBe(false)
  })

  it('ignores the empty block the editor keeps at the end of a document', () => {
    const withTrailingBlock: EntryDocument = {
      type: 'doc',
      content: [...paragraph.content, { type: 'paragraph' }],
    }

    expect(contentDelta(paragraph, withTrailingBlock).sameText).toBe(true)
  })

  it('reports a space typed at the end, in prose or wording, as different text', () => {
    const prose = contentDelta(paragraph, plainTextDocument('We drove up on Friday. '))
    const wording = contentDelta(
      withAnchorWording('Worth revisiting', 'anchor-1', 0, 16, 'first'),
      withAnchorWording('Worth revisiting', 'anchor-1', 0, 16, 'first '),
    )

    expect(prose.sameText).toBe(false)
    expect(wording.sameText).toBe(false)
    expect(wording.sameAnchors).toBe(true)
  })
})
