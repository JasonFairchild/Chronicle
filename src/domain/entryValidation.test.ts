import { describe, expect, it, vi } from 'vitest'
import {
  assertValidRelation,
  StaleVersionError,
  type RelationLookups,
} from '@/domain/entryValidation'
import { createEntryInput, emptyEntryDates, type Entry } from '@/types/entry'

function entry(partial: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    created_at: '2026-01-01T00:00:00.000Z',
    dates: emptyEntryDates(),
    location: null,
    original_medium: null,
    original_medium_note: null,
    parent_id: null,
    relation_type: null,
    target_id: null,
    title: null,
    content: '',
    anchors: [],
    revision_mode: null,
    base_version_id: null,
    authoring_trace: null,
    media_refs: [],
    metadata: {},
    ...partial,
  }
}

const nothing: RelationLookups = { loadParent: () => undefined, latestVersionId: (id) => id }

describe('assertValidRelation', () => {
  it('accepts a root entry, which has no relation at all', async () => {
    await expect(
      assertValidRelation(createEntryInput({ content: 'Root' }), nothing),
    ).resolves.toBeUndefined()
  })

  it('refuses a relation with nothing to relate to', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Orphan', relation_type: 'annotation' }),
        nothing,
      ),
    ).rejects.toThrow(/requires a parent_id/)
  })

  it('refuses a connection with only one endpoint', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Half a link', parent_id: 'a', relation_type: 'connection' }),
        nothing,
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
        nothing,
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
        nothing,
      ),
    ).rejects.toThrow(/Only connection entries/)
  })

  it('refuses a revision of a revision, because a version chain is linear', async () => {
    const loadParent = async () => entry({ id: 'rev-1', relation_type: 'revision' })

    await expect(
      assertValidRelation(
        createEntryInput({ content: 'Again', parent_id: 'rev-1', relation_type: 'revision' }),
        { ...nothing, loadParent },
      ),
    ).rejects.toThrow(/cannot revise another revision/)
  })

  it('allows a revision of an ordinary entry, written against its latest version', async () => {
    const loadParent = async () => entry({ id: 'root-1' })

    await expect(
      assertValidRelation(
        createEntryInput({
          content: 'Reworded',
          parent_id: 'root-1',
          relation_type: 'revision',
          base_version_id: 'root-1',
        }),
        { ...nothing, loadParent },
      ),
    ).resolves.toBeUndefined()
  })

  it('refuses a revision written against a version since replaced', async () => {
    const check = assertValidRelation(
      createEntryInput({
        content: 'Reworded',
        parent_id: 'root-1',
        relation_type: 'revision',
        base_version_id: 'root-1',
      }),
      { ...nothing, latestVersionId: () => 'revision-2' },
    )

    await expect(check).rejects.toThrow(StaleVersionError)
    await expect(check).rejects.toHaveProperty(
      'message',
      'The revision’s base version is no longer its entry’s latest',
    )
  })

  it('refuses a base version on anything that is not a revision', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({
          content: 'Note',
          parent_id: 'root-1',
          relation_type: 'annotation',
          base_version_id: 'root-1',
        }),
        nothing,
      ),
    ).rejects.toThrow(/Only revisions/)
  })

  it('allows a child whose parent has not arrived yet', async () => {
    await expect(
      assertValidRelation(
        createEntryInput({
          content: 'Early',
          parent_id: 'not-here-yet',
          relation_type: 'annotation',
        }),
        nothing,
      ),
    ).resolves.toBeUndefined()
  })

  it('never reads anything for a rule that does not need it', async () => {
    const lookups = { loadParent: vi.fn(nothing.loadParent), latestVersionId: vi.fn((id) => id) }

    await assertValidRelation(
      createEntryInput({ content: 'Note', parent_id: 'root-1', relation_type: 'annotation' }),
      lookups,
    )

    expect(lookups.loadParent).not.toHaveBeenCalled()
    expect(lookups.latestVersionId).not.toHaveBeenCalled()
  })
})
