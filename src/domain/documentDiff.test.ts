import { describe, expect, it } from 'vitest'
import { diffDocuments, diffPlainText, type DiffSegment } from '@/domain/documentDiff'
import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  serializeDocument,
  textContent,
} from '@/domain/entryDocument'

/** The later version, rebuilt from the diff — what a reader of the "after" side would see. */
function after(segments: DiffSegment[]): string {
  return segments
    .filter((segment) => segment.kind !== 'removed')
    .map((segment) => segment.text)
    .join('')
}

/** The earlier version, rebuilt from the same diff. */
function before(segments: DiffSegment[]): string {
  return segments
    .filter((segment) => segment.kind !== 'added')
    .map((segment) => segment.text)
    .join('')
}

describe('diffPlainText', () => {
  it('reports unchanged text as one run, with nothing added or removed', () => {
    expect(diffPlainText('I went to Lake Tahoe', 'I went to Lake Tahoe')).toEqual([
      { kind: 'unchanged', text: 'I went to Lake Tahoe' },
    ])
  })

  it('narrows a replacement to the words that actually changed', () => {
    expect(
      diffPlainText('I went to Lake Tahoe with Dad', 'I went to Donner Lake with Dad'),
    ).toEqual([
      { kind: 'unchanged', text: 'I went to ' },
      { kind: 'added', text: 'Donner ' },
      { kind: 'unchanged', text: 'Lake ' },
      { kind: 'removed', text: 'Tahoe ' },
      { kind: 'unchanged', text: 'with Dad' },
    ])
  })

  it('marks an inserted word without disturbing what surrounds it', () => {
    expect(diffPlainText('the cat sat', 'the big cat sat')).toEqual([
      { kind: 'unchanged', text: 'the ' },
      { kind: 'added', text: 'big ' },
      { kind: 'unchanged', text: 'cat sat' },
    ])
  })

  it('marks a removed word without disturbing what surrounds it', () => {
    expect(diffPlainText('the big cat sat', 'the cat sat')).toEqual([
      { kind: 'unchanged', text: 'the ' },
      { kind: 'removed', text: 'big ' },
      { kind: 'unchanged', text: 'cat sat' },
    ])
  })

  it('reads a version written from nothing as entirely new, and one emptied as entirely gone', () => {
    expect(diffPlainText('', 'A first line')).toEqual([{ kind: 'added', text: 'A first line' }])
    expect(diffPlainText('A first line', '')).toEqual([{ kind: 'removed', text: 'A first line' }])
  })

  it('keeps the line breaks between blocks, so a diff can be laid out as paragraphs', () => {
    const segments = diffPlainText('First thought\n\nSecond thought', 'First thought\n\nThird one')

    expect(segments).toEqual([
      { kind: 'unchanged', text: 'First thought\n\n' },
      { kind: 'removed', text: 'Second thought' },
      { kind: 'added', text: 'Third one' },
    ])
    expect(after(segments)).toBe('First thought\n\nThird one')
    expect(before(segments)).toBe('First thought\n\nSecond thought')
  })

  it('rebuilds both versions exactly, including where a whole paragraph was inserted', () => {
    const earlier = 'One morning.\n\nThen the afternoon.\n\nThen bed.'
    const later = 'One morning.\n\nThen a long walk.\n\nThen the afternoon.\n\nThen bed.'

    const segments = diffPlainText(earlier, later)

    expect(before(segments)).toBe(earlier)
    expect(after(segments)).toBe(later)
  })

  it('falls back to a whole-block replacement when a long entry was rewritten outright', () => {
    const earlier = Array.from({ length: 2_500 }, (_, index) => `old${index}`).join(' ')
    const later = Array.from({ length: 2_500 }, (_, index) => `new${index}`).join(' ')

    expect(diffPlainText(earlier, later)).toEqual([
      { kind: 'removed', text: earlier },
      { kind: 'added', text: later },
    ])
  })
})

describe('diffDocuments', () => {
  it('compares what two documents say, not how they are built', () => {
    expect(diffDocuments(textContent('I stayed home'), textContent('I stayed in'))).toEqual([
      { kind: 'unchanged', text: 'I stayed ' },
      { kind: 'removed', text: 'home' },
      { kind: 'added', text: 'in' },
    ])
  })

  it('reports no change for a revision that only reformatted the same words', () => {
    const plain = textContent('It rained all day')
    const bolded = serializeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'It rained ' },
            { type: 'text', text: 'all day', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })

    expect(diffDocuments(plain, bolded)).toEqual([{ kind: 'unchanged', text: 'It rained all day' }])
  })

  it('ignores wording a child entry proposed, which the parent’s author never wrote', () => {
    const annotated = serializeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'I went to Lake Tahoe',
              marks: [{ type: ANCHOR_MARK, attrs: { anchorId: 'anchor-1', kind: 'strike' } }],
            },
            {
              type: ANCHOR_INSERT_NODE,
              attrs: { anchorId: 'anchor-1', text: 'I went to Donner Lake' },
            },
          ],
        },
      ],
    })

    // The anchor mark and its wording are what a child added; the entry still says what it said.
    expect(diffDocuments(textContent('I went to Lake Tahoe'), annotated)).toEqual([
      { kind: 'unchanged', text: 'I went to Lake Tahoe' },
    ])
  })
})
