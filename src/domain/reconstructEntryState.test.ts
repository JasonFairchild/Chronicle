import { describe, expect, it } from 'vitest'
import { reconstructEntryState } from '@/domain/reconstructEntryState'
import type { Entry } from '@/types/entry'

function makeEntry(overrides: Partial<Entry> & Pick<Entry, 'id' | 'content'>): Entry {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    parent_id: null,
    relation_type: null,
    type: 'text',
    media_refs: [],
    metadata: {},
    target_id: null,
    ...overrides,
  }
}

describe('reconstructEntryState', () => {
  it('returns root content when there are no related entries', () => {
    const root = makeEntry({ id: 'root-1', content: 'Original text' })
    const result = reconstructEntryState('root-1', [root])

    expect(result).toEqual({
      id: 'root-1',
      type: 'text',
      content: 'Original text',
      created_at: root.created_at,
      media_refs: [],
      metadata: {},
      applied_relations: [],
    })
  })

  it('applies update and annotation relations in created_at order', () => {
    const root = makeEntry({ id: 'root-1', content: 'Original text' })
    const update = makeEntry({
      id: 'update-1',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Updated text',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    const annotation = makeEntry({
      id: 'annotation-1',
      parent_id: 'root-1',
      relation_type: 'annotation',
      content: 'Remember this context',
      created_at: '2026-01-03T00:00:00.000Z',
    })

    const result = reconstructEntryState('root-1', [root, update, annotation])

    expect(result?.content).toBe('Updated text\n\n[Annotation] Remember this context')
    expect(result?.applied_relations).toEqual(['update', 'annotation'])
  })

  it('respects asOf when reconstructing historical state', () => {
    const root = makeEntry({ id: 'root-1', content: 'Original text' })
    const update = makeEntry({
      id: 'update-1',
      parent_id: 'root-1',
      relation_type: 'update',
      content: 'Updated text',
      created_at: '2026-01-02T00:00:00.000Z',
    })

    const result = reconstructEntryState(
      'root-1',
      [root, update],
      new Date('2026-01-01T12:00:00.000Z'),
    )

    expect(result?.content).toBe('Original text')
    expect(result?.applied_relations).toEqual([])
  })
})
