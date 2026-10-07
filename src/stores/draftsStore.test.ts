import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { StaleVersionError } from '@/domain/entryValidation'
import {
  draftRepository,
  entryRepository,
  setDraftRepository,
  setEntryRepository,
} from '@/repositories'
import { InMemoryDraftRepository } from '@/repositories/inMemoryDraftRepository'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { DRAFT_FLUSH_MS, useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, type AggregatedEntry } from '@/types/entry'

/** An entry already on record, as a session opened against it would find it. */
async function existingEntry(text: string): Promise<AggregatedEntry> {
  const created = await entryRepository.create(createEntryInput({ content: textContent(text) }))
  return (await useEntriesStore().getAggregatedEntry(created.id))!
}

/** Another tab: its own stores over the same storage. */
function anotherTab() {
  setActivePinia(createPinia())
  return useDraftsStore()
}

describe('useDraftsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Fresh in-memory adapters per test. The Dexie ones get their own persistence proof in
    // dexieDraftRepository.browser.test.ts; the store only needs to prove it talks to whatever
    // the composition root points at.
    const entries = new InMemoryEntryRepository()
    setEntryRepository(entries)
    setDraftRepository(new InMemoryDraftRepository(entries))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('writing while the writer types', () => {
    it('writes typing that never pauses every DRAFT_FLUSH_MS, rather than waiting for a pause', async () => {
      vi.useFakeTimers()
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })
      const save = vi.spyOn(draftRepository, 'save')

      store.recordChange(sessionId, {
        content: textContent('It rai'),
        steps: [{ stepType: 'replace' }],
      })
      await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS - 1)
      store.recordChange(sessionId, {
        content: textContent('It rained'),
        steps: [{ stepType: 'replace' }],
      })
      expect(save).not.toHaveBeenCalled()

      // A debounce would have restarted on the second change and still be waiting.
      await vi.advanceTimersByTimeAsync(1)

      expect(save).toHaveBeenCalledOnce()
      const flushed = await draftRepository.getById(sessionId)
      expect(docToPlainText(flushed!.entry.content)).toBe('It rained')
      expect(flushed?.entry.events).toHaveLength(2)
    })

    it('leaves a snapshot pending when its write fails, rather than retiring it unwritten', async () => {
      vi.useFakeTimers()
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })

      // A full disk, a blocked database, a private window evicting storage — rare, but the
      // snapshot is only in memory until this call lands.
      const save = vi.spyOn(draftRepository, 'save').mockRejectedValueOnce(new Error('Quota'))

      store.recordChange(sessionId, {
        content: textContent('It rained all day.'),
        steps: [{ stepType: 'replace' }],
      })
      await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

      expect(save).toHaveBeenCalledTimes(1)
      expect(await draftRepository.getById(sessionId)).toBeNull()
      expect(store.error).toBe('Quota')

      // Still pending, so the next chance to write takes it — here, the composer closing.
      // Counting the failed attempt as written would have retired these words unsaved.
      await store.abandonDraft(sessionId)

      expect(docToPlainText((await draftRepository.getById(sessionId))!.entry.content)).toBe(
        'It rained all day.',
      )
    })

    it('writes a bookmark taken between flushes, rather than dropping it with the timer', async () => {
      vi.useFakeTimers()
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })

      store.recordChange(sessionId, {
        content: textContent('It rained all day.'),
        steps: [{ stepType: 'replace' }],
      })
      await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)
      expect(await draftRepository.getById(sessionId)).not.toBeNull()

      // Nothing else pending — a manual bookmark alone has to be enough to schedule a write.
      store.addMark(sessionId)
      await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

      const flushed = await draftRepository.getById(sessionId)
      expect(flushed?.entry.events.map((event) => event.kind)).toEqual(['edit', 'manual'])
    })

    it('moves the snapshot but not the trace for a change that produced no steps', async () => {
      vi.useFakeTimers()
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })

      store.recordChange(sessionId, {
        content: textContent('We drove up on Friday'),
        steps: [{ stepType: 'replace' }],
      })
      // What retitling looks like from here: the title is a plain field beside the editor, so it
      // produces no steps and the body's own chain has nothing to record.
      store.recordChange(sessionId, {
        content: textContent('We drove up on Friday'),
        title: 'Lake Tahoe',
        steps: [],
      })

      await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

      const flushed = await draftRepository.getById(sessionId)
      expect(flushed?.entry.content).toBe(textContent('We drove up on Friday'))
      expect(flushed?.entry.title).toBe('Lake Tahoe')
      expect(flushed?.entry.events).toHaveLength(1)
    })
  })

  describe('ending a session', () => {
    it.each(['sealDraft', 'discardDraft'] as const)(
      'does not resurrect a draft when %s races an in-flight flush',
      async (end) => {
        vi.useFakeTimers()
        const store = useDraftsStore()
        const sessionId = store.beginDraft({ kind: 'new_root' })
        store.recordChange(sessionId, {
          content: textContent('A day at the lake'),
          steps: [{ stepType: 'replace' }],
        })

        // Let the scheduled flush actually start its write, but hold it open so ending the
        // session can race it — this is exactly the window the fix has to close.
        const originalSave = draftRepository.save.bind(draftRepository)
        let releaseSave: () => void = () => {}
        const held = new Promise<void>((resolve) => {
          releaseSave = resolve
        })
        vi.spyOn(draftRepository, 'save').mockImplementationOnce(async (draft, persisted) => {
          await held
          return originalSave(draft, persisted)
        })

        await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)
        // The flush's write is now in flight, awaiting `held`.

        const ending = store[end](sessionId)
        releaseSave()
        await ending

        expect(await draftRepository.getById(sessionId)).toBeNull()
      },
    )

    it('still writes what was typed since the last flush when a seal is refused', async () => {
      vi.useFakeTimers()
      const store = useDraftsStore()
      const original = await existingEntry('I recieved the offer')
      const sessionId = store.beginDraft({ kind: 'revision', parent: original })

      // Another tab saves a version first, so this draft's seal will be refused.
      await entryRepository.create(
        createEntryInput({
          content: textContent('I got the offer'),
          parent_id: original.id,
          relation_type: 'revision',
          revision_mode: 'direct',
          base_version_id: original.id,
        }),
      )
      store.recordChange(sessionId, {
        content: textContent('I received the offer'),
        steps: [{ stepType: 'replace' }],
      })

      // Sealing cancels the scheduled flush, so a refusal has to schedule another.
      await expect(store.sealDraft(sessionId)).rejects.toThrow(StaleVersionError)
      await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

      const stored = await draftRepository.getById(sessionId)
      expect(docToPlainText(stored!.entry.content)).toBe('I received the offer')
    })

    it('refuses to seal an empty draft and leaves the session open', async () => {
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })
      store.recordChange(sessionId, {
        content: textContent('   '),
        steps: [{ stepType: 'replace' }],
      })

      await expect(store.sealDraft(sessionId)).rejects.toThrow('Entry content cannot be empty')
      expect(docToPlainText(store.currentDraft(sessionId)!.entry.content)).toBe('   ')
    })
  })

  describe('resuming', () => {
    it('resumes a draft left behind by a reload with its history intact', async () => {
      const store = useDraftsStore()
      await seedDraft(
        draftRepository,
        makeDraft('interrupted', {
          entry: {
            content: textContent('Half a thought'),
            events: [
              { kind: 'edit', at: 1_000, steps: [{ stepType: 'replace' }] },
              { kind: 'manual', at: 1_500 },
            ],
          },
        }),
      )

      const resumed = await store.resumeDraft('interrupted')
      store.recordChange('interrupted', {
        content: textContent('Half a thought, finished.'),
        steps: [{ stepType: 'replace' }],
      })
      const sealed = await store.sealDraft('interrupted')

      expect(docToPlainText(resumed!.entry.content)).toBe('Half a thought')
      const trace = (await useEntriesStore().getEntry(sealed.id))?.authoring_trace
      expect(trace?.started_at).toBe('2026-09-05T10:00:00.000Z')
      expect(trace?.events.map((event) => event.kind)).toEqual(['edit', 'manual', 'edit'])
    })

    it('carries the parent’s own log through a resume', async () => {
      const store = useDraftsStore()
      const parentContent = 'The meeting went badly'
      const parent = await existingEntry(parentContent)
      const markedParentContent = withAnchorMark(parentContent, 'anchor-1', 4, 11)

      await seedDraft(
        draftRepository,
        makeDraft('interrupted-anchor', {
          kind: relatedTo(parent, {
            content: markedParentContent,
            events: [
              { kind: 'edit', at: 1_000, steps: [{ stepType: 'addMark' }], is_anchor_op: true },
            ],
          }),
        }),
      )

      await store.resumeDraft('interrupted-anchor')
      store.recordChange('interrupted-anchor', {
        content: textContent('Worth revisiting.'),
        steps: [{ stepType: 'replace' }],
      })
      await store.sealDraft('interrupted-anchor')

      const [parentRevision] = await entryRepository.listRevisions(parent.id)
      // Resumed intact, not restarted: the parent's log and its base survived the reload.
      expect(parentRevision?.authoring_trace).toEqual(
        expect.objectContaining({
          base_content: textContent(parentContent),
          events: [
            { kind: 'edit', at: 1_000, steps: [{ stepType: 'addMark' }], is_anchor_op: true },
          ],
        }),
      )
    })

    it('resumes what is on disk, not what this tab held when it last let the draft go', async () => {
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })
      store.recordChange(sessionId, {
        content: textContent('Half a thought'),
        steps: [{ stepType: 'replace' }],
      })
      await store.abandonDraft(sessionId)

      // Another tab picks the draft up and carries on with it.
      const stored = (await draftRepository.getById(sessionId))!
      await draftRepository.save(
        {
          ...stored,
          entry: {
            ...stored.entry,
            content: textContent('Half a thought, finished elsewhere'),
            events: [...stored.entry.events, { kind: 'edit', at: 5_000, steps: [{ n: 2 }] }],
          },
        },
        { entry: stored.entry.events.length, parent: 0 },
      )

      const resumed = await store.resumeDraft(sessionId)

      expect(docToPlainText(resumed!.entry.content)).toBe('Half a thought, finished elsewhere')
      expect(resumed?.entry.events).toHaveLength(2)
    })
  })

  // A revision's claim is taken and released through the page in EntryDetailView's specs; these
  // are the cases no page reaches yet.
  describe('a draft that could revise an entry', () => {
    it('claims the entry the moment a related-entry draft opens, so another tab resumes it instead', async () => {
      const store = useDraftsStore()
      const parent = await existingEntry('The meeting went badly')

      const sessionId = store.beginDraft({ kind: 'new_related', parent })
      // Nothing typed: the claim is written on its own, and this waits for it to land.
      await store.flush(sessionId)

      const otherTab = anotherTab()
      await otherTab.loadDrafts()
      expect(otherTab.drafts).toEqual([
        expect.objectContaining({
          session_id: sessionId,
          kind: 'new_related',
          parent_id: parent.id,
        }),
      ])
      expect(await otherTab.resumeDraft(sessionId)).not.toBeNull()
    })

    it('releases an untouched related-entry claim once its composer closes', async () => {
      const store = useDraftsStore()
      const parent = await existingEntry('The meeting went badly')
      const sessionId = store.beginDraft({ kind: 'new_related', parent })

      await store.abandonDraft(sessionId)

      expect(await draftRepository.list()).toEqual([])
    })

    it('keeps its claim on disk while its session is open, even emptied', async () => {
      const store = useDraftsStore()
      const parent = await existingEntry('The meeting went badly')
      const sessionId = store.beginDraft({ kind: 'new_related', parent })

      store.recordChange(sessionId, {
        content: textContent('It rained'),
        steps: [{ stepType: 'replace' }],
      })
      await store.flush(sessionId)
      store.recordChange(sessionId, { content: '', steps: [{ stepType: 'replace' }] })
      await store.flush(sessionId)

      // Removing it here would let another tab begin a second draft on the same version.
      expect(await draftRepository.list()).toHaveLength(1)
    })

    it('releases a revision changed back to the version it started from', async () => {
      const store = useDraftsStore()
      const original = await existingEntry('I recieved the offer')
      const sessionId = store.beginDraft({ kind: 'revision', parent: original })

      store.recordChange(sessionId, {
        content: textContent('I received the offer'),
        steps: [{ stepType: 'replace' }],
      })
      await store.flush(sessionId)
      store.recordChange(sessionId, {
        content: textContent('I recieved the offer'),
        steps: [{ stepType: 'replace' }],
      })
      await store.abandonDraft(sessionId)

      expect(await draftRepository.list()).toEqual([])
    })

    it('keeps a claim another tab has written in when this one lets it go', async () => {
      const store = useDraftsStore()
      const original = await existingEntry('I recieved the offer')
      const sessionId = store.beginDraft({ kind: 'revision', parent: original })
      await store.flush(sessionId)

      const otherTab = anotherTab()
      await otherTab.resumeDraft(sessionId)
      otherTab.recordChange(sessionId, {
        content: textContent('I received the offer'),
        steps: [{ stepType: 'replace' }],
      })
      await otherTab.flush(sessionId)

      // Untouched here, but judged by what disk holds, not by what this tab did.
      await store.abandonDraft(sessionId)

      const stored = await draftRepository.getById(sessionId)
      expect(docToPlainText(stored!.entry.content)).toBe('I received the offer')
    })

    it('keeps a resumed draft that holds work when it is let go untouched', async () => {
      const store = useDraftsStore()
      const original = await existingEntry('I recieved the offer')
      await seedDraft(
        draftRepository,
        makeDraft('interrupted-revision', {
          entry: {
            base_version_id: original.id,
            base_content: original.content,
            content: textContent('I received the offer'),
          },
          kind: { kind: 'revision', parent_id: original.id },
        }),
      )

      await store.resumeDraft('interrupted-revision')
      await store.abandonDraft('interrupted-revision')

      expect(await draftRepository.getById('interrupted-revision')).not.toBeNull()
    })

    it('refreshes the drafts list on return, so a claim made in another tab shows here', async () => {
      const store = useDraftsStore()
      const original = await existingEntry('I recieved the offer')
      await store.loadDrafts()

      await seedDraft(
        draftRepository,
        makeDraft('claimed-elsewhere', {
          entry: { base_version_id: original.id, base_content: original.content },
          kind: { kind: 'revision', parent_id: original.id },
        }),
      )
      await store.adoptChangesElsewhere()

      expect(store.drafts.map((draft) => draft.session_id)).toEqual(['claimed-elsewhere'])
    })
  })
})
