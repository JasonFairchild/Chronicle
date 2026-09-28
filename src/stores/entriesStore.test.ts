import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEntriesStore } from '@/stores/entriesStore'
import {
  docToPlainText,
  plainTextDocument,
  serializeDocument,
  textContent,
  type EntryDocument,
} from '@/domain/entryDocument'
import { entryRepository, setEntryRepository } from '@/repositories'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, parentDocument } from '@/testing/draftFixtures'
import type { Draft } from '@/types/draft'
import { createEntryInput, type Entry } from '@/types/entry'

/**
 * Writes what sealing `draft` would, and the timeline catches up, without a draft store around it:
 * that `seal` also removes the draft is the draft repository's contract.
 */
async function sealDraft(draft: Draft): Promise<Entry> {
  const store = useEntriesStore()
  const written = await entryRepository.createMany(await store.inputsForDraft(draft, null))
  await store.showWritten(written)
  return written[written.length - 1]!
}

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
    const draft = makeDraft('session-untitled', {
      // The field was offered and not filled in — whitespace typed and abandoned collapses to null
      // the same way. Nothing is owed — a journal entry that would only ever be named "Tuesday" is
      // better left unnamed.
      title: '   ',
      content: serializeDocument(plainTextDocument('We drove up on Friday.')),
    })

    const sealed = await sealDraft(draft)

    expect(sealed.title).toBeNull()
    expect(docToPlainText(sealed.content)).toBe('We drove up on Friday.')
    expect(await entryRepository.listRootEntries()).toHaveLength(1)
  })

  it('gives a related entry the title its draft carries', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')

    const draft = makeDraft(
      'session-titled-related',
      {
        title: 'A later thought',
        content: serializeDocument(plainTextDocument('Still think about this trip')),
      },
      {
        kind: 'new_related',
        parent_id: parent.id,
        parent: parentDocument(parent.id, parent.content),
      },
    )

    const sealed = await sealDraft(draft)

    expect(sealed.title).toBe('A later thought')
  })

  it('returns aggregated entry state from the repository data', async () => {
    const store = useEntriesStore()
    const created = await store.createTextEntry('Root content')

    const aggregated = await store.getAggregatedEntry(created.id)
    expect(docToPlainText(aggregated!.content)).toBe('Root content')
  })

  it('never alters the parent’s stored row when a related entry is created', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')

    await store.createRelatedEntry({
      parentId: parent.id,
      relationType: 'annotation',
      content: 'Miss those trips',
    })

    expect(docToPlainText((await store.getEntry(parent.id))!.content)).toBe(
      'I went to Lake Tahoe with Dad',
    )
  })

  it('anchors a related entry to a passage by sealing it together with a parent revision', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('I went to Lake Tahoe with Dad')
    const marked = withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20)

    const draft = makeDraft(
      'session-1',
      { content: textContent('It was actually Donner Lake') },
      {
        kind: 'new_related',
        parent_id: parent.id,
        // "anchor-1 is this session's" is the difference between these two documents, not a list.
        parent: parentDocument(parent.id, textContent('I went to Lake Tahoe with Dad'), marked),
      },
    )

    await sealDraft(draft)

    // The anchor's position is now a fact about the parent's own document, not the related entry,
    // so the parent gained a version and the related entry holds only a reference to it.
    const aggregated = await store.getAggregatedEntry(parent.id)
    expect(aggregated?.version.total).toBe(2)
    expect(aggregated?.related_entries).toHaveLength(1)
    // Commenting claims nothing changed, so the kind follows from the anchor rather than a picker.
    expect(aggregated?.related_entries[0]?.relation_type).toBe('annotation')
    expect(aggregated?.related_entries[0]?.anchors).toEqual([
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

    const draft = makeDraft(
      'session-2',
      { content: textContent('It was actually Donner Lake') },
      {
        kind: 'new_related',
        parent_id: parent.id,
        parent: parentDocument(parent.id, textContent('I went to Lake Tahoe with Dad'), struck),
      },
    )

    await sealDraft(draft)

    const aggregated = await store.getAggregatedEntry(parent.id)
    expect(aggregated?.related_entries[0]?.relation_type).toBe('update')
  })

  it('carries the dates a writer supplied through to the entry and its aggregate', async () => {
    const store = useEntriesStore()

    const draft = makeDraft('session-3', {
      dates: {
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'late morning',
      },
      content: textContent('Transcribed out of the green notebook'),
    })

    const created = await sealDraft(draft)

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
    // included, which is what this test mirrors via a revision draft instead of the shortcut.
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

    const draft = makeDraft(
      'session-4',
      {
        content: serializeDocument({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A day at Donner Lake' }] },
            { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } },
          ],
        }),
        base_version_id: created.id,
      },
      { kind: 'revision', parent_id: created.id },
    )

    await sealDraft(draft)

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
    const draft = makeDraft('session-dated', {
      dates: {
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'morning',
      },
      content: serializeDocument(plainTextDocument('From the notebook')),
    })
    const created = await sealDraft(draft)

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

  it('keeps a related entry out of the root timeline', async () => {
    const store = useEntriesStore()
    const parent = await store.createTextEntry('Root')

    await store.createRelatedEntry({
      parentId: parent.id,
      relationType: 'annotation',
      content: 'A note',
    })
    await store.loadRootEntries()

    expect(store.rootCount).toBe(1)
  })

  describe('refusing a write it cannot make', () => {
    /** A sealed draft standing in for whichever session the test is about to refuse. */
    function draftFor(
      kind: NonNullable<Parameters<typeof makeDraft>[2]>,
      body: string,
      title: string | null = null,
    ): Draft {
      return makeDraft(
        'session-refused',
        {
          title,
          content: serializeDocument(plainTextDocument(body)),
          base_version_id: kind.kind === 'revision' ? kind.parent_id : null,
        },
        kind,
      )
    }

    it('will not revise an entry that is not there', async () => {
      const store = useEntriesStore()

      await expect(
        store.reviseEntry({ entryId: 'never-created', content: 'Some new wording' }),
      ).rejects.toThrow('Cannot revise an entry that does not exist')
      await expect(
        sealDraft(draftFor({ kind: 'revision', parent_id: 'never-created' }, 'Words')),
      ).rejects.toThrow('Cannot revise an entry that does not exist')
    })

    it('will not annotate an entry that is not there', async () => {
      const parentText = 'I went to Lake Tahoe'
      // An anchor placed since the session began is what sends this down the sealing path at all;
      // without one it would be an ordinary unanchored note and never look the parent up.
      const draft = draftFor(
        {
          kind: 'new_related',
          parent_id: 'never-created',
          parent: parentDocument(
            'never-created',
            textContent(parentText),
            withAnchorMark(parentText, 'anchor-1', 10, 20),
          ),
        },
        'A note',
      )

      await expect(sealDraft(draft)).rejects.toThrow('Cannot annotate an entry that does not exist')
    })

    it('will not seal a revision draft that changed nothing the version holds', async () => {
      const store = useEntriesStore()
      const created = await store.createTextEntry('Nothing to see here')
      const kind = { kind: 'revision', parent_id: created.id } as const

      await expect(sealDraft(draftFor(kind, 'Nothing to see here'))).rejects.toThrow(
        'No changes to save',
      )
      // The same words under a new name is a real revision, though — the title rides the chain.
      await expect(sealDraft(draftFor(kind, 'Nothing to see here', 'Tahoe'))).resolves.toBeDefined()
    })

    it('counts formatting as a change, but not the empty block the editor keeps at the end', async () => {
      const store = useEntriesStore()
      const created = await store.createTextEntry('Nothing to see here')
      const words = { type: 'text', text: 'Nothing to see here' }
      const revisedTo = (content: EntryDocument) =>
        makeDraft(
          'session-refused',
          { content: serializeDocument(content), base_version_id: created.id },
          { kind: 'revision', parent_id: created.id },
        )

      await expect(
        sealDraft(
          revisedTo({
            type: 'doc',
            content: [{ type: 'paragraph', content: [words] }, { type: 'paragraph' }],
          }),
        ),
      ).rejects.toThrow('No changes to save')
      await expect(
        sealDraft(
          revisedTo({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ ...words, marks: [{ type: 'bold' }] }] }],
          }),
        ),
      ).resolves.toBeDefined()
    })

    it('surfaces why the timeline could not be loaded, rather than failing blank', async () => {
      const repository = new InMemoryEntryRepository()
      repository.listRootEntries = () => Promise.reject(new Error('Storage is unavailable'))
      setEntryRepository(repository)
      const store = useEntriesStore()

      await expect(store.loadRootEntries()).rejects.toThrow('Storage is unavailable')

      expect(store.error).toBe('Storage is unavailable')
      expect(store.loading).toBe(false)
    })
  })
})
