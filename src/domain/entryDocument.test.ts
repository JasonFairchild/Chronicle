import { describe, expect, it } from 'vitest'
import {
  collectMediaRefs,
  docTitle,
  docToPlainText,
  isEmptyDocument,
  parseDocument,
  plainTextDocument,
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

  it('reads a serialized document and a bare string identically', () => {
    const serialized = serializeDocument(plainTextDocument('First line\nSecond line'))

    expect(docToPlainText(serialized)).toBe('First line\nSecond line')
    expect(docToPlainText('First line\nSecond line')).toBe('First line\nSecond line')
  })

  it('treats prose that merely starts with a brace as prose', () => {
    expect(docToPlainText('{ this is not JSON, it is a thought }')).toBe(
      '{ this is not JSON, it is a thought }',
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
