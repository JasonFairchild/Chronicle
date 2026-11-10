import { beforeEach, describe, expect, it } from 'vitest'

import { StaleVersionError } from '@/domain/entryValidation'
import { seedEntry } from '@/testing/seedEntry'
import { createEntryInput } from '@/types/entry'

import type { EntryRepository } from './entryRepository'

/**
 * One behavioral contract, run against every `EntryRepository` implementation. This is what makes
 * the composition root's "swap the backend by changing one import" claim provable rather than
 * asserted: the in-memory and Dexie adapters both have to pass the exact same assertions, so
 * nothing about what "correct" means is adapter-specific.
 */
export function runEntryRepositoryContract(
  label: string,
  createRepository: () => EntryRepository | Promise<EntryRepository>,
): void {
  describe(`EntryRepository contract (${label})`, () => {
    let repository: EntryRepository

    beforeEach(async () => {
      repository = await createRepository()
    })

    it('creates and retrieves a root entry', async () => {
      const [created] = await repository.createMany([
        createEntryInput({ content: 'Hello Chronicle' }),
      ])

      expect(created?.id).toBeTruthy()
      expect(created?.parent_id).toBeNull()
      expect(created?.relation_type).toBeNull()

      const fetched = await repository.getById(created!.id)
      expect(fetched?.content).toBe('Hello Chronicle')
    })

    it('writes nothing from a batch when any entry in it is refused', async () => {
      const root = await seedEntry({ content: 'One' }, repository)
      const revision = (content: string) =>
        createEntryInput({
          content,
          parent_id: root.id,
          relation_type: 'revision',
          base_version_id: root.id,
        })

      // The second is stale against the first, which the batch has written but not committed.
      await expect(repository.createMany([revision('Two'), revision('Also two')])).rejects.toThrow(
        StaleVersionError,
      )

      expect(await repository.listRevisions(root.id)).toEqual([])
    })

    it('lists root entries newest first without needing timestamps to differ', async () => {
      // Created back to back, so `created_at` is very likely identical. Ordering holds anyway
      // because ids are time-ordered and break the tie.
      await seedEntry({ content: 'First' }, repository)
      await seedEntry({ content: 'Second' }, repository)

      const roots = await repository.listRootEntries()

      expect(roots.map((entry) => entry.content)).toEqual(['Second', 'First'])
    })

    it('lists only revisions as versions, not the related entries beside them', async () => {
      const parent = await seedEntry({ content: 'Root' }, repository)
      await seedEntry(
        { content: 'Child note', parent_id: parent.id, relation_type: 'annotation' },
        repository,
      )
      await seedEntry(
        {
          content: 'Reworded root',
          parent_id: parent.id,
          relation_type: 'revision',
          base_version_id: parent.id,
        },
        repository,
      )

      const revisions = await repository.listRevisions(parent.id)

      expect(revisions.map((entry) => entry.content)).toEqual(['Reworded root'])
    })

    it('returns revisions oldest first, so the version chain folds in order', async () => {
      const parent = await seedEntry({ content: 'Root' }, repository)
      let base = parent.id
      for (const content of ['Second', 'Third', 'Fourth']) {
        const revision = await seedEntry(
          { content, parent_id: parent.id, relation_type: 'revision', base_version_id: base },
          repository,
        )
        base = revision.id
      }

      const revisions = await repository.listRevisions(parent.id)

      expect(revisions.map((entry) => entry.content)).toEqual(['Second', 'Third', 'Fourth'])
    })

    it('refuses a revision of a version that is no longer the latest, so versions never branch', async () => {
      const root = await seedEntry({ content: 'One' }, repository)
      const revise = (content: string) =>
        repository.createMany([
          createEntryInput({
            content,
            parent_id: root.id,
            relation_type: 'revision',
            base_version_id: root.id,
          }),
        ])

      await revise('Two')
      // Written against version one too, as a second tab would have been.
      await expect(revise('Also two')).rejects.toThrow(StaleVersionError)

      const revisions = await repository.listRevisions(root.id)
      expect(revisions.map((entry) => entry.content)).toEqual(['Two'])
      expect(revisions[0]?.base_version_id).toBe(root.id)
    })

    it('refuses a revision that names no version it replaces', async () => {
      const root = await seedEntry({ content: 'One' }, repository)

      await expect(
        repository.createMany([
          createEntryInput({ content: 'Two', parent_id: root.id, relation_type: 'revision' }),
        ]),
      ).rejects.toThrow('must name the version it replaces')
    })

    it('stores a copy, so mutating the input afterwards cannot rewrite history', async () => {
      const input = createEntryInput({ content: 'Root', metadata: { mood: 'calm' } })
      const [created] = await repository.createMany([input])

      input.metadata.mood = 'frantic'
      input.media_refs.push('never-attached')

      const fetched = await repository.getById(created!.id)

      expect(fetched?.metadata).toEqual({ mood: 'calm' })
      expect(fetched?.media_refs).toEqual([])
    })

    it('collects a subtree plus connections pointing into it', async () => {
      const root = await seedEntry({ content: 'Root' }, repository)
      const child = await seedEntry(
        { content: 'Child', parent_id: root.id, relation_type: 'annotation' },
        repository,
      )
      await seedEntry(
        { content: 'Grandchild', parent_id: child.id, relation_type: 'annotation' },
        repository,
      )
      const outsider = await seedEntry({ content: 'Elsewhere' }, repository)
      await seedEntry(
        {
          content: 'Points at the root',
          parent_id: outsider.id,
          target_id: root.id,
          relation_type: 'connection',
        },
        repository,
      )

      const descendants = await repository.listDescendants(root.id)
      const contents = descendants.map((entry) => entry.content)

      expect(contents).toContain('Root')
      expect(contents).toContain('Grandchild')
      expect(contents).toContain('Points at the root')
      expect(contents).not.toContain('Elsewhere')
    })

    it('follows an incoming connection’s own children too, not just the connection itself', async () => {
      const root = await seedEntry({ content: 'Root' }, repository)
      const outsider = await seedEntry({ content: 'Elsewhere' }, repository)
      const connection = await seedEntry(
        {
          content: 'Points at the root',
          parent_id: outsider.id,
          target_id: root.id,
          relation_type: 'connection',
        },
        repository,
      )
      await seedEntry(
        {
          content: 'A note on that connection',
          parent_id: connection.id,
          relation_type: 'annotation',
        },
        repository,
      )

      const descendants = await repository.listDescendants(root.id)
      const contents = descendants.map((entry) => entry.content)

      expect(contents).toContain('Points at the root')
      expect(contents).toContain('A note on that connection')
    })

    it('refuses a relation with nothing to relate to', async () => {
      await expect(
        repository.createMany([
          createEntryInput({ content: 'Orphan note', relation_type: 'annotation' }),
        ]),
      ).rejects.toThrow(/requires a parent_id/)
    })

    it('refuses a revision of a revision', async () => {
      const root = await seedEntry({ content: 'Root' }, repository)
      const revision = await seedEntry(
        {
          content: 'Reworded',
          parent_id: root.id,
          relation_type: 'revision',
          base_version_id: root.id,
        },
        repository,
      )

      await expect(
        repository.createMany([
          createEntryInput({
            content: 'Reworded again',
            parent_id: revision.id,
            relation_type: 'revision',
            base_version_id: revision.id,
          }),
        ]),
      ).rejects.toThrow(/cannot revise another revision/)
    })

    it('refuses a connection without a target and a target without a connection', async () => {
      const root = await seedEntry({ content: 'Root' }, repository)

      await expect(
        repository.createMany([
          createEntryInput({
            content: 'Half a link',
            parent_id: root.id,
            relation_type: 'connection',
          }),
        ]),
      ).rejects.toThrow(/requires a target_id/)

      await expect(
        repository.createMany([
          createEntryInput({
            content: 'Stray target',
            parent_id: root.id,
            target_id: root.id,
            relation_type: 'annotation',
          }),
        ]),
      ).rejects.toThrow(/Only connection entries/)
    })

    it('refuses a connection whose two endpoints are the same entry', async () => {
      const root = await seedEntry({ content: 'Root' }, repository)

      await expect(
        repository.createMany([
          createEntryInput({
            content: 'Self link',
            parent_id: root.id,
            target_id: root.id,
            relation_type: 'connection',
          }),
        ]),
      ).rejects.toThrow(/two different entries/)
    })
  })
}
