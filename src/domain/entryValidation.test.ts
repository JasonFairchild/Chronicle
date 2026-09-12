import { describe, expect, it, vi } from 'vitest'
import { assertValidRelation } from '@/domain/entryValidation'
import { createEntryInput, emptyEntryDates, type Entry } from '@/types/entry'

function entry(partial: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    created_at: '2026-01-01T00:00:00.000Z',
    ...emptyEntryDates(),
    parent_id: null,
    relation_type: null,
    target_id: null,
    title: null,
    content: '',
    anchors: [],
    revision_mode: null,
    authoring_trace: null,
    media_refs: [],
    metadata: {},
    ...partial,
  }
}

const noParent = () => undefined

describe('assertValidRelation', () => {
  it('accepts a root entry, which has no relation at all', async () => {
    await expect(
      assertValidRelation(createEntryInput({ content: 'Root' }), noParent),
    ).resolves.toBeUndefined()
  })

  it('refuses a relation with nothing to relate to', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Orphan', relation_type: 'annotation' }),
        noParent,
      ),
    ).rejects.toThrow(/requires a parent_id/)
  })

  it('refuses a connection with only one endpoint', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Half a link', parent_id: 'a', relation_type: 'connection' }),
        noParent,
      ),
    ).rejects.toThrow(/requires a target_id/)
  })

  it('refuses a connection whose endpoints are the same entry', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({
          content: 'Self link',
          parent_id: 'a',
          target_id: 'a',
          relation_type: 'connection',
        }),
        noParent,
      ),
    ).rejects.toThrow(/two different entries/)
  })

  it('refuses a target on anything that is not a connection', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({
          content: 'Stray target',
          parent_id: 'a',
          target_id: 'b',
          relation_type: 'annotation',
        }),
        noParent,
      ),
    ).rejects.toThrow(/Only connection entries/)
  })

  it('refuses a revision of a revision, because a version chain is linear', async () => {
    const loadParent = async () => entry({ id: 'rev-1', relation_type: 'revision' })

    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Again', parent_id: 'rev-1', relation_type: 'revision' }),
        loadParent,
      ),
    ).rejects.toThrow(/cannot revise another revision/)
  })

  it('allows a revision of an ordinary entry', async () => {
    const loadParent = async () => entry({ id: 'root-1' })

    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Reworded', parent_id: 'root-1', relation_type: 'revision' }),
        loadParent,
      ),
    ).resolves.toBeUndefined()
  })

  it('allows a child whose parent has not arrived yet', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({
          content: 'Early',
          parent_id: 'not-here-yet',
          relation_type: 'annotation',
        }),
        noParent,
      ),
    ).resolves.toBeUndefined()
  })

  it('never loads a parent for a rule that does not need one', async () => {
    const loadParent = vi.fn(noParent)

    await assertValidRelation(
      createEntryInput({ content: 'Note', parent_id: 'root-1', relation_type: 'annotation' }),
      loadParent,
    )

    expect(loadParent).not.toHaveBeenCalled()
  })
})
