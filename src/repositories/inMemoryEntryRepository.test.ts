import { describe, expect, it, beforeEach } from 'vitest'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { createEntryInput } from '@/types/entry'

describe('InMemoryEntryRepository', () => {
  let repository: InMemoryEntryRepository

  beforeEach(() => {
    repository = new InMemoryEntryRepository()
  })

  it('creates and retrieves a root text entry', async () => {
    const created = await repository.create(
      createEntryInput({ type: 'text', content: 'Hello Chronicle' }),
    )

    expect(created.id).toBeTruthy()
    expect(created.parent_id).toBeNull()
    expect(created.content).toBe('Hello Chronicle')

    const fetched = await repository.getById(created.id)
    expect(fetched?.content).toBe('Hello Chronicle')
  })

  it('lists root entries newest first', async () => {
    const first = await repository.create(createEntryInput({ type: 'text', content: 'First' }))
    const second = await repository.create(createEntryInput({ type: 'text', content: 'Second' }))

    second.created_at = new Date(Date.now() + 1000).toISOString()
    repository.seed([first, second])

    const roots = await repository.listRootEntries()
    expect(roots.map((entry) => entry.content)).toEqual(['Second', 'First'])
  })

  it('lists direct children for a parent entry', async () => {
    const parent = await repository.create(createEntryInput({ type: 'text', content: 'Root' }))
    await repository.create(
      createEntryInput({
        type: 'text',
        content: 'Child note',
        parent_id: parent.id,
        relation_type: 'annotation',
      }),
    )

    const children = await repository.listChildren(parent.id)
    expect(children).toHaveLength(1)
    expect(children[0]?.relation_type).toBe('annotation')
  })
})
