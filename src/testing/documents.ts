import type { DocNode, EntryDocument } from '@/domain/entryDocument'

/**
 * Documents for test data, built from bare strings. The app never builds one this way: every
 * document it stores comes out of the editor.
 */

/** Wraps plain text as a document, one paragraph per line. */
export function plainTextDocument(text: string): EntryDocument {
  const paragraphs = text.split('\n').map((line): DocNode => {
    return line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  })

  return { type: 'doc', content: paragraphs }
}

/** A document as `Entry.content` stores it. */
export function serializeDocument(doc: EntryDocument): string {
  return JSON.stringify(doc)
}

/**
 * Plain text as stored content. A title is never part of it: a title is a sibling field on the
 * entry (ENTRY_MODEL.md, "Fields").
 */
export function textContent(body: string): string {
  return serializeDocument(plainTextDocument(body))
}
