import { beforeEach, describe, expect, it } from 'vitest'
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
      const created = await repository.create(createEntryInput({ content: 'Hello Chronicle' }))

      expect(created.id).toBeTruthy()
      expect(created.parent_id).toBeNull()
      expect(created.relation_type).toBeNull()

      const fetched = await repository.getById(created.id)
      expect(fetched?.content).toBe('Hello Chronicle')
    })

    it('lists root entries newest first without needing timestamps to differ', async () => {
      // Created back to back, so `created_at` is very likely identical. Ordering holds anyway
      // because ids are time-ordered and break the tie.
      await repository.create(createEntryInput({ content: 'First' }))
      await repository.create(createEntryInput({ content: 'Second' }))

      const roots = await repository.listRootEntries()

      expect(roots.map((entry) => entry.content)).toEqual(['Second', 'First'])
    })

    it('excludes revisions from listChildren so they cannot render as notes', async () => {
      const parent = await repository.create(createEntryInput({ content: 'Root' }))
      await repository.create(
        createEntryInput({
          content: 'Child note',
          parent_id: parent.id,
          relation_type: 'annotation',
        }),
      )
      await repository.create(
        createEntryInput({
          content: 'Reworded root',
          parent_id: parent.id,
          relation_type: 'revision',
        }),
      )

      const children = await repository.listChildren(parent.id)
      const revisions = await repository.listRevisions(parent.id)

      expect(children).toHaveLength(1)
      expect(children[0]?.relation_type).toBe('annotation')
      expect(revisions).toHaveLength(1)
      expect(revisions[0]?.content).toBe('Reworded root')
    })

    it('returns revisions oldest first, so the version chain folds in order', async () => {
      const parent = await repository.create(createEntryInput({ content: 'Root' }))
      for (const content of ['Second', 'Third', 'Fourth']) {
        await repository.create(
          createEntryInput({ content, parent_id: parent.id, relation_type: 'revision' }),
        )
      }

      const revisions = await repository.listRevisions(parent.id)

      expect(revisions.map((entry) => entry.content)).toEqual(['Second', 'Third', 'Fourth'])
    })

    it('stores a copy, so mutating the input afterwards cannot rewrite history', async () => {
      const input = createEntryInput({ content: 'Root', metadata: { mood: 'calm' } })
      const created = await repository.create(input)

      input.metadata.mood = 'frantic'
      input.media_refs.push('never-attached')

      const fetched = await repository.getById(created.id)

      expect(fetched?.metadata).toEqual({ mood: 'calm' })
      expect(fetched?.media_refs).toEqual([])
    })

    it('finds connections from either endpoint', async () => {
      const from = await repository.create(createEntryInput({ content: 'A' }))
      const to = await repository.create(createEntryInput({ content: 'B' }))
      await repository.create(
        createEntryInput({
          content: 'These belong together',
          parent_id: from.id,
          target_id: to.id,
          relation_type: 'connection',
        }),
      )

      expect(await repository.listConnectionsFor(from.id)).toHaveLength(1)
      expect(await repository.listConnectionsFor(to.id)).toHaveLength(1)
    })

    it('collects a subtree plus connections pointing into it', async () => {
      const root = await repository.create(createEntryInput({ content: 'Root' }))
      const child = await repository.create(
        createEntryInput({ content: 'Child', parent_id: root.id, relation_type: 'annotation' }),
      )
      await repository.create(
        createEntryInput({
          content: 'Grandchild',
          parent_id: child.id,
          relation_type: 'annotation',
        }),
      )
      const outsider = await repository.create(createEntryInput({ content: 'Elsewhere' }))
      await repository.create(
        createEntryInput({
          content: 'Points at the root',
          parent_id: outsider.id,
          target_id: root.id,
          relation_type: 'connection',
        }),
      )

      const descendants = await repository.listDescendants(root.id)
      const contents = descendants.map((entry) => entry.content)

      expect(contents).toContain('Root')
      expect(contents).toContain('Grandchild')
      expect(contents).toContain('Points at the root')
      expect(contents).not.toContain('Elsewhere')
    })

    it('follows an incoming connection’s own children too, not just the connection itself', async () => {
      const root = await repository.create(createEntryInput({ content: 'Root' }))
      const outsider = await repository.create(createEntryInput({ content: 'Elsewhere' }))
      const connection = await repository.create(
        createEntryInput({
          content: 'Points at the root',
          parent_id: outsider.id,
          target_id: root.id,
          relation_type: 'connection',
        }),
      )
      await repository.create(
        createEntryInput({
          content: 'A note on that connection',
          parent_id: connection.id,
          relation_type: 'annotation',
        }),
      )

      const descendants = await repository.listDescendants(root.id)
      const contents = descendants.map((entry) => entry.content)

      expect(contents).toContain('Points at the root')
      expect(contents).toContain('A note on that connection')
    })

    it('refuses a relation with nothing to relate to', async () => {
      await expect(
        repository.create(
          createEntryInput({ content: 'Orphan note', relation_type: 'annotation' }),
        ),
      ).rejects.toThrow(/requires a parent_id/)
    })

    it('refuses a revision of a revision', async () => {
      const root = await repository.create(createEntryInput({ content: 'Root' }))
      const revision = await repository.create(
        createEntryInput({ content: 'Reworded', parent_id: root.id, relation_type: 'revision' }),
      )

      await expect(
        repository.create(
          createEntryInput({
            content: 'Reworded again',
            parent_id: revision.id,
            relation_type: 'revision',
          }),
        ),
      ).rejects.toThrow(/cannot revise another revision/)
    })

    it('refuses a connection without a target and a target without a connection', async () => {
      const root = await repository.create(createEntryInput({ content: 'Root' }))

      await expect(
        repository.create(
          createEntryInput({
            content: 'Half a link',
            parent_id: root.id,
            relation_type: 'connection',
          }),
        ),
      ).rejects.toThrow(/requires a target_id/)

      await expect(
        repository.create(
          createEntryInput({
            content: 'Stray target',
            parent_id: root.id,
            target_id: root.id,
            relation_type: 'annotation',
          }),
        ),
      ).rejects.toThrow(/Only connection entries/)
    })

    it('refuses a connection whose two endpoints are the same entry', async () => {
      const root = await repository.create(createEntryInput({ content: 'Root' }))

      await expect(
        repository.create(
          createEntryInput({
            content: 'Self link',
            parent_id: root.id,
            target_id: root.id,
            relation_type: 'connection',
          }),
        ),
      ).rejects.toThrow(/two different entries/)
    })
  })
}
