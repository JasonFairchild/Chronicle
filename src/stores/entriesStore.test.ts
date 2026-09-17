import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEntriesStore } from '@/stores/entriesStore'
import {
  docToPlainText,
  plainTextDocument,
  serializeDocument,
  textContent,
} from '@/domain/entryDocument'
import { entryRepository, setEntryRepository } from '@/repositories'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { withAnchorMark } from '@/testing/anchorFixtures'
import type { Draft } from '@/types/draft'
import { createEntryInput, emptyEntryDates } from '@/types/entry'

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
    expect(docToPlainText(store.rootEntries[0]!.content)).toBe('First timeline entry')
  })

  it('rejects empty content', async () => {
    const store = useEntriesStore()
    await expect(store.createTextEntry('   ')).rejects.toThrow('Entry content cannot be empty')
  })

  it('seals a draft whose title field was left empty, storing no title for it', async () => {
    const store = useEntriesStore()
    const draft: Draft = {
      session_id: 'session-untitled',
      target: { kind: 'new_root' },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: emptyEntryDates(),
      // The field was offered and not filled in — whitespace typed and abandoned collapses to null
      // the same way. Nothing is owed — a journal entry that would only ever be named "Tuesday" is
      // better left unnamed.
      title: '   ',
      child: {
        content: serializeDocument(plainTextDocument('We drove up on Friday.')),
        steps: [],
        ticks: [],
      },
      parent: null,
    }

    const sealed = await store.createFromDraft(draft, null)

    expect(sealed.title).toBeNull()
    expect(docToPlainText(sealed.content)).toBe('We drove up on Friday.')
    expect(await entryRepository.listRootEntries()).toHaveLength(1)
  })

  it('gives a related entry the title its draft carries', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')

    const draft: Draft = {
      session_id: 'session-titled-child',
      target: { kind: 'new_child', parent_id: parent.id },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: emptyEntryDates(),
      title: 'A later thought',
      child: {
        content: serializeDocument(plainTextDocument('Still think about this trip')),
        steps: [],
        ticks: [],
      },
      parent: null,
    }

    const sealed = await store.createFromDraft(draft, null)

    expect(sealed.title).toBe('A later thought')
  })

  it('returns aggregated entry state from the repository data', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('Root content')

    const aggregated = await store.getAggregatedEntry(created.id)
    expect(docToPlainText(aggregated!.content)).toBe('Root content')
  })

  it('never alters the parent’s stored row when a child is created', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')

    await store.createChildEntry({
      parentId: parent.id,
      relationType: 'annotation',
      content: 'Miss those trips',
    })

    expect(docToPlainText((await store.getEntry(parent.id))!.content)).toBe(
      'I went to Lake Tahoe with Dad',
    )
  })

  it('anchors a child to a passage by sealing a parent revision and the child together', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')
    const marked = withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20)

    const draft: Draft = {
      session_id: 'session-1',
      target: { kind: 'new_child', parent_id: parent.id },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: emptyEntryDates(),
      title: null,
      child: {
        content: textContent('It was actually Donner Lake'),
        steps: [],
        ticks: [],
      },
      // "anchor-1 is this session's" is the difference between these two documents, not a list.
      parent: {
        content: marked,
        title: null,
        base_content: textContent('I went to Lake Tahoe with Dad'),
        steps: [],
        ticks: [],
      },
    }

    await store.createFromDraft(draft, null)

    // The anchor's position is now a fact about the parent's own document, not the child, so the
    // parent gained a version and the child holds only a reference to it.
    const aggregated = await store.getAggregatedEntry(parent.id)
    expect(aggregated?.version.total).toBe(2)
    expect(aggregated?.children).toHaveLength(1)
    // Commenting claims nothing changed, so the kind follows from the anchor rather than a picker.
    expect(aggregated?.children[0]?.relation_type).toBe('annotation')
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

  it('reads a struck passage as an update, since striking reports a correction', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')
    const struck = withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20, 'strike')

    const draft: Draft = {
      session_id: 'session-2',
      target: { kind: 'new_child', parent_id: parent.id },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: emptyEntryDates(),
      title: null,
      child: {
        content: textContent('It was actually Donner Lake'),
        steps: [],
        ticks: [],
      },
      parent: {
        content: struck,
        title: null,
        base_content: textContent('I went to Lake Tahoe with Dad'),
        steps: [],
        ticks: [],
      },
    }

    await store.createFromDraft(draft, null)

    const aggregated = await store.getAggregatedEntry(parent.id)
    expect(aggregated?.children[0]?.relation_type).toBe('update')
  })

  it('carries the dates a writer supplied through to the entry and its aggregate', async () => {
    const store = useEntriesStore()

    const draft: Draft = {
      session_id: 'session-3',
      target: { kind: 'new_root' },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: {
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'late morning',
      },
      title: null,
      child: {
        content: textContent('Transcribed out of the green notebook'),
        steps: [],
        ticks: [],
      },
      parent: null,
    }

    const created = await store.createFromDraft(draft, null)

    expect(created.dates.occurred_at).toBe('1994-06-11')
    expect(created.dates.recorded_time_note).toBe('evening')

    const aggregated = await store.getAggregatedEntry(created.id)
    expect(aggregated?.dates).toEqual({
      recorded_at: '1994-06-12',
      recorded_time_note: 'evening',
      occurred_at: '1994-06-11',
      occurred_time_note: 'late morning',
    })
  })

  it('surfaces a connection on both entries it joins', async () => {
    const store = useEntriesStore()
    const from = await store.createTextEntry('Left my job')
    const to = await store.createTextEntry('Started the degree')

    await store.createConnection({
      fromId: from.id,
      toId: to.id,
      content: 'One made the other possible',
    })

    const source = await store.getAggregatedEntry(from.id)
    const destination = await store.getAggregatedEntry(to.id)

    expect(source?.connections[0]?.direction).toBe('outgoing')
    expect(destination?.connections[0]?.direction).toBe('incoming')
  })

  it('keeps an entry’s media through a revision whose new document still contains it', async () => {
    // `reviseEntry`'s plain-text shortcut always writes a fresh, image-free document — media_refs
    // is derived from the document, with no exception any more (ENTRY_MODEL.md), so it can only
    // stay populated when the revision's own content still carries the image node. That's exactly
    // what the real editor does: it seeds a revision from the current, full document, images
    // included, which is what this test mirrors via `createFromDraft` instead of the shortcut.
    const store = useEntriesStore()
    const withPhoto = serializeDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A day at the lake' }] },
        { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } },
      ],
    })
    const created = await entryRepository.create(
      createEntryInput({ content: withPhoto, media_refs: ['blob-1'] }),
    )

    const draft: Draft = {
      session_id: 'session-4',
      target: { kind: 'revision', parent_id: created.id },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: emptyEntryDates(),
      title: null,
      child: {
        content: serializeDocument({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A day at Donner Lake' }] },
            { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } },
          ],
        }),
        steps: [],
        ticks: [],
      },
      parent: null,
    }

    await store.createFromDraft(draft, null)

    const aggregated = await store.getAggregatedEntry(created.id)
    // The image is a block node of its own, so it contributes an empty trailing line.
    expect(docToPlainText(aggregated!.content).trim()).toBe('A day at Donner Lake')
    expect(aggregated?.media_refs).toEqual(['blob-1'])
  })

  it('shows the revised text on the timeline rather than the original', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('I recieved the offer')

    await store.reviseEntry({ entryId: created.id, content: 'I received the offer' })
    await store.loadRootEntries()

    expect(docToPlainText(store.rootEntries[0]!.content)).toBe('I received the offer')
    expect(store.rootEntries[0]?.version.total).toBe(2)
  })

  it('reports the version chain oldest first', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('One')

    await store.reviseEntry({ entryId: created.id, content: 'Two' })

    const history = await store.getEntryHistory(created.id)
    expect(history.map((version) => docToPlainText(version.content))).toEqual(['One', 'Two'])
  })

  it('carries the author’s dates through a revision instead of dropping them', async () => {
    const store = useEntriesStore()
    const draft: Draft = {
      session_id: 'session-dated',
      target: { kind: 'new_root' },
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      dates: {
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'morning',
      },
      title: null,
      child: {
        content: serializeDocument(plainTextDocument('From the notebook')),
        steps: [],
        ticks: [],
      },
      parent: null,
    }
    const created = await store.createFromDraft(draft, null)

    await store.reviseEntry({ entryId: created.id, content: 'From the notebook, typed up' })

    const aggregated = await store.getAggregatedEntry(created.id)
    expect(aggregated?.dates).toEqual({
      recorded_at: '1994-06-12',
      recorded_time_note: 'evening',
      occurred_at: '1994-06-11',
      occurred_time_note: 'morning',
    })
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

    expect(docToPlainText(store.rootEntries[0]!.content)).toBe('Final wording')
    expect(store.rootEntries[0]?.version.total).toBe(2)
  })

  it('prepends a newly created root without reloading the rest of the timeline', async () => {
    const store = useEntriesStore()
    await store.createTextEntry('First')
    await store.loadRootEntries()

    await store.createTextEntry('Second')

    expect(store.rootEntries.map((entry) => docToPlainText(entry.content))).toEqual([
      'Second',
      'First',
    ])
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
