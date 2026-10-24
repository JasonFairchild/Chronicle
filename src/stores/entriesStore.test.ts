import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { docToPlainText, type EntryDocument } from '@/domain/entryDocument'
import { entryRepository, setEntryRepository } from '@/repositories'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { useEntriesStore } from '@/stores/entriesStore'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { plainTextDocument, serializeDocument, textContent } from '@/testing/documents'
import { type DraftKind, makeDraft, relatedTo } from '@/testing/draftFixtures'
import type { Draft } from '@/types/draft'
import { createEntryInput, type Entry } from '@/types/entry'

/** An entry already on record, written straight to storage. */
function seedEntry(text: string): Promise<Entry> {
  return entryRepository.create(createEntryInput({ content: textContent(text) }))
}

/** A draft of `kind` holding `body`; a revision starts from its parent's first version. */
function draftFor(kind: DraftKind, body: string, title: string | null = null): Draft {
  return makeDraft('session-1', {
    entry: {
      title,
      content: serializeDocument(plainTextDocument(body)),
      base_version_id: kind.kind === 'revision' ? kind.parent_id : null,
    },
    kind,
  })
}

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

  it('loads the root timeline from the repository', async () => {
    const store = useEntriesStore()
    await seedEntry('First timeline entry')

    await store.loadRootEntries()

    expect(store.rootEntries.map((entry) => docToPlainText(entry.content))).toEqual([
      'First timeline entry',
    ])
  })

  it('rejects empty content', async () => {
    await expect(sealDraft(draftFor({ kind: 'new_root' }, '   '))).rejects.toThrow(
      'Entry content cannot be empty',
    )
  })

  it('gives a related entry the title its draft carries', async () => {
    const parent = await seedEntry('I went to Lake Tahoe with Dad')

    const sealed = await sealDraft(
      draftFor(relatedTo(parent), 'Still think about this trip', 'A later thought'),
    )

    expect(sealed.title).toBe('A later thought')
  })

  it('anchors a related entry to a passage by sealing it together with a parent revision', async () => {
    const store = useEntriesStore()
    const parent = await seedEntry('I went to Lake Tahoe with Dad')
    const marked = withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20)

    const draft = makeDraft('session-1', {
      entry: { content: textContent('It was actually Donner Lake') },
      // "anchor-1 is this session's" is the difference between these two documents, not a list.
      kind: relatedTo(parent, { content: marked }),
    })

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
    // The anchors went into a new version; the row the parent was written as is untouched.
    expect((await entryRepository.getById(parent.id))?.content).toBe(parent.content)
  })

  it('surfaces a connection on both entries it joins', async () => {
    const store = useEntriesStore()
    const from = await seedEntry('Left my job')
    const to = await seedEntry('Started the degree')

    await sealDraft(
      draftFor(
        { kind: 'new_connection', parent_id: from.id, target_id: to.id },
        'One made the other possible',
      ),
    )

    const source = await store.getAggregatedEntry(from.id)
    const destination = await store.getAggregatedEntry(to.id)

    expect(source?.connections[0]?.direction).toBe('outgoing')
    expect(destination?.connections[0]?.direction).toBe('incoming')
  })

  it('keeps an entry’s media through a revision whose new document still contains it', async () => {
    // `media_refs` is derived from the document (ENTRY_MODEL.md), so it stays populated only when
    // the revision's own content still carries the image node — as it does from the real editor,
    // which seeds a revision from the current, full document, images included.
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

    const draft = makeDraft('session-4', {
      entry: {
        content: serializeDocument({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A day at Donner Lake' }] },
            { type: 'mediaImage', attrs: { mediaRef: 'blob-1' } },
          ],
        }),
        base_version_id: created.id,
      },
      kind: { kind: 'revision', parent_id: created.id },
    })

    await sealDraft(draft)

    const aggregated = await store.getAggregatedEntry(created.id)
    // The image is a block node of its own, so it contributes an empty trailing line.
    expect(docToPlainText(aggregated!.content).trim()).toBe('A day at Donner Lake')
    expect(aggregated?.media_refs).toEqual(['blob-1'])
  })

  it('shows the revised text on the timeline rather than the original', async () => {
    const store = useEntriesStore()
    const created = await seedEntry('I recieved the offer')
    await sealDraft(draftFor({ kind: 'revision', parent_id: created.id }, 'I received the offer'))

    await store.loadRootEntries()

    expect(docToPlainText(store.rootEntries[0]!.content)).toBe('I received the offer')
    expect(store.rootEntries[0]?.version.total).toBe(2)
  })

  it('updates the revised root in place, without reloading the rest of the timeline', async () => {
    const store = useEntriesStore()
    const created = await seedEntry('Draft wording')
    await store.loadRootEntries()

    await sealDraft(draftFor({ kind: 'revision', parent_id: created.id }, 'Final wording'))

    expect(docToPlainText(store.rootEntries[0]!.content)).toBe('Final wording')
    expect(store.rootEntries[0]?.version.total).toBe(2)
  })

  it('prepends a newly created root without reloading the rest of the timeline', async () => {
    const store = useEntriesStore()
    await seedEntry('First')
    await store.loadRootEntries()

    await sealDraft(draftFor({ kind: 'new_root' }, 'Second'))

    expect(store.rootEntries.map((entry) => docToPlainText(entry.content))).toEqual([
      'Second',
      'First',
    ])
  })

  it('keeps a related entry out of the root timeline', async () => {
    const store = useEntriesStore()
    const parent = await seedEntry('Root')
    await store.loadRootEntries()

    await sealDraft(draftFor(relatedTo(parent), 'A note'))

    expect(store.rootEntries.map((entry) => entry.id)).toEqual([parent.id])
  })

  describe('refusing a write it cannot make', () => {
    it('will not revise an entry that is not there', async () => {
      await expect(
        sealDraft(draftFor({ kind: 'revision', parent_id: 'never-created' }, 'Words')),
      ).rejects.toThrow('Cannot revise an entry that does not exist')
    })

    it('will not annotate an entry that is not there', async () => {
      const parentText = 'I went to Lake Tahoe'
      // An anchor placed since the session began is what sends this down the sealing path at all;
      // without one it would be an ordinary unanchored note and never look the parent up.
      const draft = draftFor(
        relatedTo(
          { id: 'never-created', content: textContent(parentText) },
          { content: withAnchorMark(parentText, 'anchor-1', 10, 20) },
        ),
        'A note',
      )

      await expect(sealDraft(draft)).rejects.toThrow('Cannot annotate an entry that does not exist')
    })

    it('will not seal a revision draft that changed nothing the version holds', async () => {
      const created = await seedEntry('Nothing to see here')
      const kind = { kind: 'revision', parent_id: created.id } as const

      await expect(sealDraft(draftFor(kind, 'Nothing to see here'))).rejects.toThrow(
        'No changes to save',
      )
      // The same words under a new name is a real revision, though — the title rides the chain.
      await expect(sealDraft(draftFor(kind, 'Nothing to see here', 'Tahoe'))).resolves.toBeDefined()
    })

    it('counts formatting as a change, but not the empty block the editor keeps at the end', async () => {
      const created = await seedEntry('Nothing to see here')
      const words = { type: 'text', text: 'Nothing to see here' }
      const revisedTo = (content: EntryDocument) =>
        makeDraft('session-refused', {
          entry: { content: serializeDocument(content), base_version_id: created.id },
          kind: { kind: 'revision', parent_id: created.id },
        })

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
      repository.listRootEntries = () => Promise.reject(new Error('listRootEntries rejected'))
      setEntryRepository(repository)
      const store = useEntriesStore()

      await expect(store.loadRootEntries()).rejects.toThrow('listRootEntries rejected')

      expect(store.error).toBe('listRootEntries rejected')
      expect(store.loading).toBe(false)
    })
  })
})
