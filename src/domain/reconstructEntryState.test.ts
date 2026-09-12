import { describe, expect, it } from 'vitest'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { buildEntryHistory, reconstructEntryState } from '@/domain/reconstructEntryState'
import { emptyEntryDates, type Entry } from '@/types/entry'

/**
 * Every test here writes plain text and reads it back through `docToPlainText`, not `.content`
 * directly — `content` is a real serialized document, and plain text is just the shorthand this
 * file writes it as. This is the fold's own correctness, not the document format's, so wrapping it
 * here keeps every test below unchanged.
 */
function makeEntry(overrides: Partial<Entry> & Pick<Entry, 'id' | 'content'>): Entry {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    ...emptyEntryDates(),
    parent_id: null,
    relation_type: null,
    target_id: null,
    title: null,
    anchors: [],
    revision_mode: null,
    authoring_trace: null,
    media_refs: [],
    metadata: {},
    ...overrides,
    content: textContent(overrides.content),
  }
}

describe('reconstructEntryState', () => {
  it('returns the entry’s own content when it has no relations', () => {
    const root = makeEntry({ id: 'root-1', content: 'Original text' })

    const result = reconstructEntryState('root-1', [root])

    expect(docToPlainText(result!.content)).toBe('Original text')
    expect(result?.children).toEqual([])
    expect(result?.connections).toEqual([])
    expect(result?.version).toEqual({
      index: 1,
      total: 1,
      at: root.created_at,
      revision_id: null,
    })
  })

  it('never lets an update replace the parent’s content', () => {
    const root = makeEntry({ id: 'root-1', content: 'Started learning guitar.' })
    const first = makeEntry({
      id: 'update-1',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Learned first chord.',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    const second = makeEntry({
      id: 'update-2',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Played a whole song.',
      created_at: '2026-01-03T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, first, second])

    expect(docToPlainText(result!.content)).toBe('Started learning guitar.')
    expect(result?.children.map((child) => docToPlainText(child.entry.content))).toEqual([
      'Learned first chord.',
      'Played a whole song.',
    ])
  })

  it('keeps annotations out of the parent’s content', () => {
    const root = makeEntry({ id: 'root-1', content: 'Original text' })
    const annotation = makeEntry({
      id: 'annotation-1',
      parent_id: 'root-1',
      relation_type: 'annotation',
      content: 'Remember this context',
      created_at: '2026-01-02T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, annotation])

    expect(docToPlainText(result!.content)).toBe('Original text')
    expect(docToPlainText(result!.content)).not.toContain('Remember this context')
    expect(result?.children[0]?.relation_type).toBe('annotation')
  })

  it('applies revisions last-wins and reports the version position', () => {
    const root = makeEntry({ id: 'root-1', content: 'I recieved the offer' })
    const fix = makeEntry({
      id: 'revision-1',
      parent_id: 'root-1',
      relation_type: 'revision',
      content: 'I received the offer',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    const reword = makeEntry({
      id: 'revision-2',
      parent_id: 'root-1',
      relation_type: 'revision',
      content: 'I received the offer and accepted it',
      created_at: '2026-01-03T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, fix, reword])

    expect(docToPlainText(result!.content)).toBe('I received the offer and accepted it')
    expect(result?.version.index).toBe(3)
    expect(result?.version.revision_id).toBe('revision-2')
  })

  it('does not lose an update when the parent is later revised', () => {
    const root = makeEntry({ id: 'root-1', content: 'I recieved the offer' })
    const update = makeEntry({
      id: 'update-1',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Start date is March 3.',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    const revision = makeEntry({
      id: 'revision-1',
      parent_id: 'root-1',
      relation_type: 'revision',
      content: 'I received the offer',
      created_at: '2026-01-03T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, update, revision])

    expect(docToPlainText(result!.content)).toBe('I received the offer')
    expect(result?.children.map((child) => docToPlainText(child.entry.content))).toEqual([
      'Start date is March 3.',
    ])
  })

  it('carries media through a revision instead of dropping it', () => {
    const root = makeEntry({ id: 'root-1', content: 'With a photo', media_refs: ['blob-1'] })
    const revision = makeEntry({
      id: 'revision-1',
      parent_id: 'root-1',
      relation_type: 'revision',
      content: 'With a photo, reworded',
      media_refs: ['blob-1'],
      created_at: '2026-01-02T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, revision])

    expect(result?.media_refs).toEqual(['blob-1'])
  })

  it('respects asOf when reconstructing historical state', () => {
    const root = makeEntry({ id: 'root-1', content: 'Original text' })
    const revision = makeEntry({
      id: 'revision-1',
      parent_id: 'root-1',
      relation_type: 'revision',
      content: 'Revised text',
      created_at: '2026-01-02T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, revision], {
      asOf: new Date('2026-01-01T12:00:00.000Z'),
    })

    expect(docToPlainText(result!.content)).toBe('Original text')
    // Positioned within the whole chain, not just the part that had happened yet: scrubbing back
    // to this moment should read "version 1 of 2", which is what makes it navigable.
    expect(result?.version.index).toBe(1)
    expect(result?.version.total).toBe(2)
  })

  it('orders entries sharing a created_at deterministically by id', () => {
    const createdAt = '2026-01-02T00:00:00.000Z'
    const root = makeEntry({ id: 'root-1', content: 'Root' })
    const second = makeEntry({
      id: 'bbb',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Second',
      created_at: createdAt,
    })
    const first = makeEntry({
      id: 'aaa',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'First',
      created_at: createdAt,
    })

    const forwards = reconstructEntryState('root-1', [root, first, second])
    const backwards = reconstructEntryState('root-1', [root, second, first])

    expect(forwards?.children.map((child) => docToPlainText(child.entry.content))).toEqual([
      'First',
      'Second',
    ])
    expect(backwards?.children.map((child) => docToPlainText(child.entry.content))).toEqual([
      'First',
      'Second',
    ])
  })

  it('surfaces a connection from both endpoints with its direction', () => {
    const from = makeEntry({ id: 'entry-a', content: 'A' })
    const to = makeEntry({ id: 'entry-b', content: 'B' })
    const connection = makeEntry({
      id: 'connection-1',
      parent_id: 'entry-a',
      target_id: 'entry-b',
      relation_type: 'connection',
      content: 'These rhyme',
      created_at: '2026-01-02T00:00:00.000Z',
    })

    const entries = [from, to, connection]
    const source = reconstructEntryState('entry-a', entries)
    const destination = reconstructEntryState('entry-b', entries)

    expect(source?.connections).toHaveLength(1)
    expect(source?.connections[0]).toMatchObject({ direction: 'outgoing', other_id: 'entry-b' })
    expect(destination?.connections).toHaveLength(1)
    expect(destination?.connections[0]).toMatchObject({
      direction: 'incoming',
      other_id: 'entry-a',
    })
  })

  it('keeps a connection’s own children out of both endpoints', () => {
    const from = makeEntry({ id: 'entry-a', content: 'A' })
    const to = makeEntry({ id: 'entry-b', content: 'B' })
    const connection = makeEntry({
      id: 'connection-1',
      parent_id: 'entry-a',
      target_id: 'entry-b',
      relation_type: 'connection',
      content: 'These rhyme',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    const noteOnConnection = makeEntry({
      id: 'annotation-1',
      parent_id: 'connection-1',
      relation_type: 'annotation',
      content: 'Only about the link',
      created_at: '2026-01-03T00:00:00.000Z',
    })

    const entries = [from, to, connection, noteOnConnection]

    expect(reconstructEntryState('entry-a', entries)?.children).toEqual([])
    expect(reconstructEntryState('entry-b', entries)?.children).toEqual([])
    expect(reconstructEntryState('connection-1', entries)?.children).toHaveLength(1)
  })

  it('signals grandchildren without expanding them past the requested depth', () => {
    const root = makeEntry({ id: 'root-1', content: 'Root' })
    const child = makeEntry({
      id: 'child-1',
      parent_id: 'root-1',
      relation_type: 'annotation',
      content: 'Child',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    const grandchild = makeEntry({
      id: 'grandchild-1',
      parent_id: 'child-1',
      relation_type: 'annotation',
      content: 'Grandchild',
      created_at: '2026-01-03T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, child, grandchild], { depth: 1 })

    expect(result?.children[0]?.has_children).toBe(true)
    expect(result?.children[0]?.entry.children).toEqual([])
  })

  it('returns null for an unknown entry', () => {
    expect(reconstructEntryState('missing', [])).toBeNull()
  })
})

describe('buildEntryHistory', () => {
  it('returns the original state first, then each revision', () => {
    const root = makeEntry({ id: 'root-1', content: 'One' })
    const revision = makeEntry({
      id: 'revision-1',
      parent_id: 'root-1',
      relation_type: 'revision',
      content: 'Two',
      created_at: '2026-01-02T00:00:00.000Z',
    })

    const history = buildEntryHistory('root-1', [root, revision])

    expect(history?.map((version) => docToPlainText(version.content))).toEqual(['One', 'Two'])
    expect(history?.[0]?.revision_id).toBeNull()
    expect(history?.[1]?.revision_id).toBe('revision-1')
  })

  it('ignores annotations and updates, which never write content', () => {
    const root = makeEntry({ id: 'root-1', content: 'One' })
    const update = makeEntry({
      id: 'update-1',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Not a version',
      created_at: '2026-01-02T00:00:00.000Z',
    })

    expect(buildEntryHistory('root-1', [root, update])).toHaveLength(1)
  })
})
