import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEntriesStore } from '@/stores/entriesStore'
import { entryRepository, setEntryRepository } from '@/repositories'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { withAnchorMark } from '@/testing/anchorFixtures'
import type { Draft } from '@/types/draft'

describe('useEntriesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Fresh in-memory repository per test: fast and node-friendly. The composition root's real
    // default (Dexie) gets its own dedicated persistence proof in dexieEntryRepository.browser.test.ts
    // — the store doesn't need to re-prove that, only that it talks to whatever `entryRepository`
    // points at.
    setEntryRepository(new InMemoryEntryRepository())
  })

  it('creates a text entry and refreshes the root timeline', async () => {
    const store = useEntriesStore()

    await store.createTextEntry('First timeline entry')
    await store.loadRootEntries()

    expect(store.rootCount).toBe(1)
    expect(store.rootEntries[0]?.content).toBe('First timeline entry')
  })

  it('rejects empty content', async () => {
    const store = useEntriesStore()
    await expect(store.createTextEntry('   ')).rejects.toThrow('Entry content cannot be empty')
  })

  it('returns aggregated entry state from the repository data', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('Root content')

    const aggregated = await store.getAggregatedEntry(created.id)
    expect(aggregated?.content).toBe('Root content')
  })

  it('never alters the parent’s stored row when a child is created', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')

    await store.createChildEntry({
      parentId: parent.id,
      relationType: 'annotation',
      content: 'Miss those trips',
    })

    expect((await store.getEntry(parent.id))?.content).toBe('I went to Lake Tahoe with Dad')
  })

  it('anchors a child to a passage by sealing a parent revision and the child together', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')
    const marked = withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20)

    const draft: Draft = {
      session_id: 'session-1',
      target: { kind: 'new_child', parent_id: parent.id, relation_type: 'update' },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      content: 'It was actually Donner Lake',
      anchor_ids: ['anchor-1'],
      parent_content: marked,
      steps: [],
      parent_steps: [],
      ticks: [],
    }

    await store.createFromDraft(draft, null)

    // The anchor's position is now a fact about the parent's own document, not the child, so the
    // parent gained a version and the child holds only a reference to it.
    const aggregated = await store.getAggregatedEntry(parent.id)
    expect(aggregated?.version.total).toBe(2)
    expect(aggregated?.children).toHaveLength(1)
    expect(aggregated?.children[0]?.anchors).toEqual([
      {
        anchor_id: 'anchor-1',
        status: 'present',
        quote: 'Lake Tahoe',
        kind: 'comment',
        insertion: null,
      },
    ])
  })

  it('surfaces a connection on both entries it joins', async () => {
    const store = useEntriesStore()
    const from = await store.createTextEntry('Left my job')
    const to = await store.createTextEntry('Started the degree')

    await store.createConnection({
      fromId: from.id,
      toId: to.id,
      content: 'One made the other possible',
      label: 'led_to',
    })

    const source = await store.getAggregatedEntry(from.id)
    const destination = await store.getAggregatedEntry(to.id)

    expect(source?.connections[0]?.direction).toBe('outgoing')
    expect(destination?.connections[0]?.direction).toBe('incoming')
    expect(destination?.connections[0]?.label).toBe('led_to')
  })

  it('carries media forward through a revision instead of dropping it', async () => {
    const store = useEntriesStore()
    const created = await entryRepository.create({
      parent_id: null,
      relation_type: null,
      target_id: null,
      title: null,
      content: 'A day at the lake',
      anchors: [],
      revision_mode: null,
      authoring_trace: null,
      media_refs: ['blob-1'],
      metadata: {},
    })

    await store.reviseEntry({ entryId: created.id, content: 'A day at Donner Lake' })

    const aggregated = await store.getAggregatedEntry(created.id)

    expect(aggregated?.content).toBe('A day at Donner Lake')
    expect(aggregated?.media_refs).toEqual(['blob-1'])
  })

  it('shows the revised text on the timeline rather than the original', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('I recieved the offer')

    await store.reviseEntry({ entryId: created.id, content: 'I received the offer' })
    await store.loadRootEntries()

    expect(store.rootEntries[0]?.content).toBe('I received the offer')
    expect(store.rootEntries[0]?.version.total).toBe(2)
  })

  it('reports the version chain oldest first', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('One')

    await store.reviseEntry({ entryId: created.id, content: 'Two' })

    const history = await store.getEntryHistory(created.id)
    expect(history.map((version) => version.content)).toEqual(['One', 'Two'])
  })

  it('rejects a revision that changes nothing', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('Nothing to see here')

    await expect(
      store.reviseEntry({ entryId: created.id, content: 'Nothing to see here' }),
    ).rejects.toThrow('No changes to save')
  })

  it('updates the revised root in place, without reloading the rest of the timeline', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('Draft wording')
    await store.loadRootEntries()

    await store.reviseEntry({ entryId: created.id, content: 'Final wording' })

    expect(store.rootEntries[0]?.content).toBe('Final wording')
    expect(store.rootEntries[0]?.version.total).toBe(2)
  })

  it('prepends a newly created root without reloading the rest of the timeline', async () => {
    const store = useEntriesStore()
    await store.createTextEntry('First')
    await store.loadRootEntries()

    await store.createTextEntry('Second')

    expect(store.rootEntries.map((entry) => entry.content)).toEqual(['Second', 'First'])
  })

  it('keeps a child entry out of the root timeline', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('Root')

    await store.createChildEntry({
      parentId: parent.id,
      relationType: 'annotation',
      content: 'A note',
    })
    await store.loadRootEntries()

    expect(store.rootCount).toBe(1)
  })
})
