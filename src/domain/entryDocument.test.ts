import { describe, expect, it } from 'vitest'
import {
  collectMediaRefs,
  docTitle,
  docToPlainText,
  isEmptyDocument,
  parseDocument,
  plainTextDocument,
  previewText,
  sameContent,
  serializeDocument,
  type EntryDocument,
} from '@/domain/entryDocument'

const document: EntryDocument = {
  type: 'doc',
  content: [
    { type: 'title', content: [{ type: 'text', text: 'Lake Tahoe' }] },
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
  it('flattens the body one line per block and leaves the title out of it', () => {
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
})

describe('previewText', () => {
  it('collapses the body onto one line and leaves the title out of it', () => {
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

  it('shows only what the entry itself says, not wording an anchor proposes', () => {
    const annotated: EntryDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'We drove up on Friday.' },
            { type: 'anchorInsert', attrs: { anchorId: 'a1', text: 'Saturday, actually' } },
          ],
        },
      ],
    }

    expect(previewText(annotated)).toBe('We drove up on Friday.')
  })
})

describe('docTitle', () => {
  it('returns the title node text, and null when there is none or it is blank', () => {
    expect(docTitle(document)).toBe('Lake Tahoe')
    expect(docTitle(plainTextDocument('No heading here'))).toBeNull()
    expect(docTitle({ type: 'doc', content: [{ type: 'title' }] })).toBeNull()
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
  it('is true only when there is no text, no title, and no media', () => {
    expect(isEmptyDocument(plainTextDocument('   \n  '))).toBe(true)
    expect(isEmptyDocument(plainTextDocument('', 'Just a title'))).toBe(false)
    expect(
      isEmptyDocument({
        type: 'doc',
        content: [{ type: 'mediaImage', attrs: { mediaRef: 'blob-1' } }],
      }),
    ).toBe(false)
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

describe('sameContent', () => {
  const paragraph: EntryDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We drove up on Friday.' }] }],
  }

  it('ignores marks and block types, which change presentation and not words', () => {
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

    expect(sameContent(paragraph, bolded)).toBe(true)
    expect(sameContent(paragraph, asHeading)).toBe(true)
  })

  it('ignores the empty block the editor keeps at the end of a document', () => {
    const withTrailingBlock: EntryDocument = {
      type: 'doc',
      content: [...paragraph.content, { type: 'paragraph' }],
    }

    expect(sameContent(paragraph, withTrailingBlock)).toBe(true)
  })

  it('sees a change of words, of title, or of attachments', () => {
    const reworded = plainTextDocument('We drove up on Saturday.')
    const titled = plainTextDocument('We drove up on Friday.', 'Lake Tahoe')
    const withImage: EntryDocument = {
      type: 'doc',
      content: [...paragraph.content, { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } }],
    }

    expect(sameContent(paragraph, reworded)).toBe(false)
    expect(sameContent(paragraph, titled)).toBe(false)
    expect(sameContent(paragraph, withImage)).toBe(false)
  })

  it('compares a serialized document and a live one identically', () => {
    expect(sameContent(serializeDocument(paragraph), paragraph)).toBe(true)
  })
})
