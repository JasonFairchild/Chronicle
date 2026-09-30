import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { deriveMarks } from '@/domain/marks'
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
import { createEntryInput, emptyEntryDates, type AggregatedEntry } from '@/types/entry'

/** An entry already on record, as a session opened against it would find it. */
async function existingEntry(text: string): Promise<AggregatedEntry> {
  const created = await entryRepository.create(createEntryInput({ content: textContent(text) }))
  return (await useEntriesStore().getAggregatedEntry(created.id))!
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

  it('writes nothing for a composer that was opened and walked away from', async () => {
    const store = useDraftsStore()

    store.beginDraft({ kind: 'new_root' })
    await store.loadDrafts()

    expect(store.drafts).toEqual([])
  })

  it('coalesces a burst of typing into one write, then keeps the words after a reload', async () => {
    vi.useFakeTimers()
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    store.recordChange(sessionId, {
      content: textContent('It rai'),
      steps: [{ stepType: 'replace' }],
    })
    store.recordChange(sessionId, {
      content: textContent('It rained'),
      steps: [{ stepType: 'replace' }],
    })
    store.recordChange(sessionId, {
      content: textContent('It rained all day.'),
      steps: [{ stepType: 'replace' }],
    })

    expect(await draftRepository.getById(sessionId)).toBeNull()

    await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

    const flushed = await draftRepository.getById(sessionId)
    expect(docToPlainText(flushed!.entry.content)).toBe('It rained all day.')
    expect(flushed?.entry.events).toHaveLength(3)
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

  it('leaves a snapshot pending when its write fails, rather than retiring it unwritten', async () => {
    vi.useFakeTimers()
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    // A full disk, a blocked database, a private window evicting storage — rare, but the snapshot
    // is only in memory until this call lands.
    const save = vi.spyOn(draftRepository, 'save').mockRejectedValueOnce(new Error('Quota'))

    store.recordChange(sessionId, {
      content: textContent('It rained all day.'),
      steps: [{ stepType: 'replace' }],
    })
    await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

    expect(save).toHaveBeenCalledTimes(1)
    expect(await draftRepository.getById(sessionId)).toBeNull()
    expect(store.error).toBe('Quota')

    // Still pending, so the next chance to write takes it — here, the composer closing. Counting
    // the failed attempt as written would have retired these words unsaved.
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

  it('keeps the dates alongside the words, so a reload loses neither', async () => {
    vi.useFakeTimers()
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    store.recordChange(sessionId, { content: textContent('From the green notebook') })
    store.recordDates(sessionId, {
      recorded_at: '1994-06-12',
      recorded_time_note: 'evening',
      occurred_at: '1994-06-11',
      occurred_time_note: null,
    })

    await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

    const flushed = await draftRepository.getById(sessionId)
    expect(flushed?.entry.dates).toEqual({
      recorded_at: '1994-06-12',
      recorded_time_note: 'evening',
      occurred_at: '1994-06-11',
      occurred_time_note: null,
    })
  })

  it('seals a draft into one immutable entry carrying the trace, and clears the buffer', async () => {
    const store = useDraftsStore()
    const entries = useEntriesStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })
    const content = textContent('We drove up on Friday.')

    store.recordChange(sessionId, {
      content,
      title: 'Lake Tahoe',
      steps: [{ stepType: 'replace' }],
      inserted_text: 'We drove up on Friday.',
    })
    const sealed = await store.sealDraft(sessionId)

    const stored = await entries.getEntry(sealed.id)
    const trace = stored!.authoring_trace!
    expect(stored?.title).toBe('Lake Tahoe')
    expect(trace.session_id).toBe(sessionId)
    expect(deriveMarks(trace.events).map((mark) => mark.reasons)).toEqual([['punctuation']])
    expect(await draftRepository.getById(sessionId)).toBeNull()
    expect(store.drafts).toEqual([])
  })

  it('seals an anchor-mode draft as a parent revision plus a related entry referencing its anchor', async () => {
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await existingEntry(parentContent)

    const sessionId = store.beginDraft({ kind: 'new_related', parent })
    const markedParentContent = withAnchorMark(parentContent, 'anchor-1', 4, 11)
    store.recordParentChange(sessionId, {
      content: markedParentContent,
      steps: [{ stepType: 'addMark' }],
    })
    store.recordChange(sessionId, {
      content: textContent('It was salvaged later.'),
      steps: [{ stepType: 'replace' }],
    })
    const sealed = await store.sealDraft(sessionId)

    const related = await entryRepository.getById(sealed.id)
    expect(related?.parent_id).toBe(parent.id)
    expect(related?.relation_type).toBe('annotation')
    expect(related?.anchors).toEqual([{ anchor_id: 'anchor-1', quote: 'meeting' }])

    // The parent gained a revision carrying the anchor, rather than the anchor sitting only on the
    // child: an anchor's position is a fact about the parent's document (ENTRY_MODEL.md, "Related
    // entries and anchors").
    const revisions = await entryRepository.listRevisions(parent.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.revision_mode).toBe('anchor')
    expect(revisions[0]?.content).toBe(markedParentContent)
  })

  it('records an anchor op into the parent stream, the same way the entry’s own stream would', async () => {
    // One authoring pipeline, not two (AUTHORING.md, "Authoring capture"): anchor mode limits
    // what the editor can produce, not how a session records it, so `recordParentChange` and
    // `recordChange` both reach the same `TraceRecorder.record`, and the parent's own trace
    // starts from the parent as the session found it.
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await existingEntry(parentContent)

    const sessionId = store.beginDraft({ kind: 'new_related', parent })
    store.recordParentChange(sessionId, {
      content: withAnchorMark(parentContent, 'anchor-1', 4, 11),
      steps: [{ stepType: 'addMark' }],
      is_anchor_op: true,
    })
    store.recordChange(sessionId, {
      content: textContent('It was salvaged later.'),
      steps: [{ stepType: 'replace' }],
    })
    const sealed = await store.sealDraft(sessionId)

    const [parentRevision] = await entryRepository.listRevisions(parent.id)
    const parentTrace = parentRevision!.authoring_trace!
    expect(parentTrace.base_content).toBe(textContent(parentContent))
    expect(deriveMarks(parentTrace.events).map((mark) => mark.reasons)).toEqual([['anchor']])
    expect((await entryRepository.getById(sealed.id))?.authoring_trace).toBeTruthy()
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
        events: [{ kind: 'edit', at: 1_000, steps: [{ stepType: 'addMark' }], is_anchor_op: true }],
      }),
    )
  })

  it('records nothing into the parent stream for a change with no steps', async () => {
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await existingEntry(parentContent)

    const sessionId = store.beginDraft({ kind: 'new_related', parent })
    // A stray update with nothing on the transaction — no step for the log to append.
    store.recordParentChange(sessionId, { content: textContent(parentContent), steps: [] })
    store.recordChange(sessionId, {
      content: textContent('Nothing marked.'),
      steps: [{ stepType: 'replace' }],
    })
    await store.flush(sessionId)

    const current = store.currentDraft(sessionId)
    if (current?.kind !== 'new_related') throw new Error('Expected a related-entry draft')
    expect(current.parent.events).toEqual([])
  })

  it('seals a revision draft as a new version rather than touching the entry it edits', async () => {
    const store = useDraftsStore()
    const entries = useEntriesStore()
    const original = await existingEntry('I recieved the offer')

    const sessionId = store.beginDraft({ kind: 'revision', parent: original })
    store.recordChange(sessionId, {
      content: textContent('I received the offer'),
      steps: [{ stepType: 'replace' }],
    })
    await store.sealDraft(sessionId)

    const aggregated = await entries.getAggregatedEntry(original.id)
    expect(docToPlainText(aggregated!.content)).toBe('I received the offer')
    expect(aggregated?.version.total).toBe(2)
    expect(docToPlainText((await entries.getEntry(original.id))!.content)).toBe(
      'I recieved the offer',
    )
  })

  it('refuses the second of two revision drafts opened on one version, and keeps it', async () => {
    const store = useDraftsStore()
    const entries = useEntriesStore()
    const original = await existingEntry('I recieved the offer')

    const first = store.beginDraft({ kind: 'revision', parent: original })
    const second = store.beginDraft({ kind: 'revision', parent: original })
    store.recordChange(first, {
      content: textContent('I received the offer'),
      steps: [{ stepType: 'replace' }],
    })
    store.recordChange(second, {
      content: textContent('I got the offer'),
      steps: [{ stepType: 'replace' }],
    })

    await store.sealDraft(first)
    // Sealing this too would make it version three, silently undoing the first draft's fix.
    await expect(store.sealDraft(second)).rejects.toThrow('was revised after')

    const aggregated = await entries.getAggregatedEntry(original.id)
    expect(aggregated?.version.total).toBe(2)
    expect(docToPlainText(aggregated!.content)).toBe('I received the offer')
    expect(docToPlainText(store.currentDraft(second)!.entry.content)).toBe('I got the offer')
  })

  it('seals the dates a revision draft carries, starting from the version it revises', async () => {
    const store = useDraftsStore()
    const entries = useEntriesStore()
    const created = await entryRepository.create(
      createEntryInput({
        content: textContent('From the green notebook'),
        title: 'Notebook',
        location: 'home',
        dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
      }),
    )

    const sessionId = store.beginDraft({
      kind: 'revision',
      parent: (await entries.getAggregatedEntry(created.id))!,
    })
    // Only the date moves: a correction with the words left alone is still a revision.
    store.recordDates(sessionId, { ...emptyEntryDates(), occurred_at: '1994-06-12' })
    await store.sealDraft(sessionId)

    const aggregated = await entries.getAggregatedEntry(created.id)
    expect(aggregated?.version.total).toBe(2)
    expect(aggregated?.dates.occurred_at).toBe('1994-06-12')
    // Everything left untouched came along from the version the draft started from.
    expect(aggregated?.title).toBe('Notebook')
    expect(aggregated?.location).toBe('home')
  })

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

  it('lists unsealed drafts most recently touched first', async () => {
    const store = useDraftsStore()
    const older = store.beginDraft({ kind: 'new_root' })
    store.recordChange(older, { content: textContent('Older'), steps: [{ stepType: 'replace' }] })
    await store.flush(older)

    const newer = store.beginDraft({ kind: 'new_root' })
    store.recordChange(newer, { content: textContent('Newer'), steps: [{ stepType: 'replace' }] })
    await store.flush(newer)

    await store.loadDrafts()

    expect(store.drafts.map((draft) => docToPlainText(draft.entry.content))).toEqual([
      'Newer',
      'Older',
    ])
  })

  it('abandons an untouched session outright, rather than leaving it open forever', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    await store.abandonDraft(sessionId)

    expect(store.currentDraft(sessionId)).toBeNull()
  })

  it('flushes a session that was actually typed into when abandoned, and lets it go', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })
    store.recordChange(sessionId, {
      content: textContent('Half a thought'),
      steps: [{ stepType: 'replace' }],
    })

    await store.abandonDraft(sessionId)

    expect(store.currentDraft(sessionId)).toBeNull()
    const stored = await draftRepository.getById(sessionId)
    expect(docToPlainText(stored!.entry.content)).toBe('Half a thought')
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

  describe('a draft open in another tab too', () => {
    /** A draft this tab has open and on disk, which another tab then writes as `content`. */
    async function writtenElsewhere(content: string) {
      const store = useDraftsStore()
      const sessionId = store.beginDraft({ kind: 'new_root' })
      store.recordChange(sessionId, {
        content: textContent('Half a thought'),
        steps: [{ stepType: 'replace' }],
      })
      await store.flush(sessionId)

      const stored = (await draftRepository.getById(sessionId))!
      await draftRepository.save(
        {
          ...stored,
          updated_at: '2099-01-01T00:00:00.000Z',
          entry: {
            ...stored.entry,
            content: textContent(content),
            events: [...stored.entry.events, { kind: 'edit', at: 5_000, steps: [{ n: 2 }] }],
          },
        },
        { entry: stored.entry.events.length, parent: 0 },
      )
      return { store, sessionId }
    }

    it('picks up what the other tab wrote when this one is returned to', async () => {
      const { store, sessionId } = await writtenElsewhere('Half a thought, carried on elsewhere')

      await store.adoptChangesElsewhere()

      const current = store.currentDraft(sessionId)
      expect(docToPlainText(current!.entry.content)).toBe('Half a thought, carried on elsewhere')
      expect(current?.entry.events).toHaveLength(2)
      expect(store.elsewhere[sessionId]).toEqual({ count: 1, gone: false, unsaved: null })
    })

    it('closes a draft the other tab sealed or discarded', async () => {
      const { store, sessionId } = await writtenElsewhere('Irrelevant')
      await draftRepository.delete(sessionId)

      await store.adoptChangesElsewhere()

      expect(store.currentDraft(sessionId)).toBeNull()
      expect(store.elsewhere[sessionId]?.gone).toBe(true)
    })

    it('keeps the other tab’s version and offers this one’s when both wrote at once', async () => {
      const { store, sessionId } = await writtenElsewhere('Half a thought, from over there')
      // Typed here before this tab caught up, so its next write collides with the other's.
      store.recordChange(sessionId, {
        content: textContent('Half a thought, from right here'),
        steps: [{ stepType: 'replace' }],
      })

      await store.flush(sessionId)

      const stored = await draftRepository.getById(sessionId)
      expect(docToPlainText(stored!.entry.content)).toBe('Half a thought, from over there')
      expect(stored?.entry.events).toHaveLength(2)
      expect(docToPlainText(store.currentDraft(sessionId)!.entry.content)).toBe(
        'Half a thought, from over there',
      )
      expect(docToPlainText(store.elsewhere[sessionId]!.unsaved!)).toBe(
        'Half a thought, from right here',
      )
    })
  })

  describe('a draft that could revise an entry', () => {
    /** Another tab: its own stores over the same storage. */
    function anotherTab() {
      setActivePinia(createPinia())
      return useDraftsStore()
    }

    it.each(['revision', 'new_related'] as const)(
      'claims the entry the moment a %s draft opens, so another tab resumes it instead',
      async (kind) => {
        const store = useDraftsStore()
        const original = await existingEntry('I recieved the offer')

        const sessionId = store.beginDraft({ kind, parent: original })
        // Nothing typed: the claim is written on its own, and this waits for it to land.
        await store.flush(sessionId)

        const otherTab = anotherTab()
        await otherTab.loadDrafts()
        expect(otherTab.drafts).toEqual([
          expect.objectContaining({ session_id: sessionId, kind, parent_id: original.id }),
        ])
        expect(await otherTab.resumeDraft(sessionId)).not.toBeNull()
      },
    )

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

    it.each(['revision', 'new_related'] as const)(
      'releases an untouched %s claim once its composer closes',
      async (kind) => {
        const store = useDraftsStore()
        const original = await existingEntry('I recieved the offer')
        const sessionId = store.beginDraft({ kind, parent: original })

        await store.abandonDraft(sessionId)

        expect(await draftRepository.list()).toEqual([])
      },
    )

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

  it('does not resurrect a draft when sealing races an in-flight flush', async () => {
    vi.useFakeTimers()
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })
    store.recordChange(sessionId, {
      content: textContent('A day at the lake'),
      steps: [{ stepType: 'replace' }],
    })

    // Let the scheduled flush actually start its write, but hold it open so sealing can race it
    // — this is exactly the window the fix has to close.
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

    const sealPromise = store.sealDraft(sessionId)
    releaseSave()
    await sealPromise

    expect(await draftRepository.getById(sessionId)).toBeNull()
  })

  it('discards a draft on request, the only thing that ever removes work', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })
    store.recordChange(sessionId, {
      content: textContent('Never mind'),
      steps: [{ stepType: 'replace' }],
    })
    await store.flush(sessionId)

    await store.discardDraft(sessionId)

    expect(store.drafts).toEqual([])
    expect(await draftRepository.getById(sessionId)).toBeNull()
  })

  it('never writes an empty document, however the session came to hold one', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    // An editor can report a change that leaves the document empty — housekeeping, a stray
    // transaction, or a writer clearing the line. None of those is a draft.
    store.recordChange(sessionId, { content: textContent('   '), steps: [] })
    await store.flush(sessionId)

    expect(await draftRepository.list()).toEqual([])
  })

  it('removes a draft that has been emptied rather than leaving a stale snapshot', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    store.recordChange(sessionId, {
      content: textContent('It rained'),
      steps: [{ stepType: 'replace' }],
    })
    await store.flush(sessionId)
    expect(await draftRepository.list()).toHaveLength(1)

    store.recordChange(sessionId, { content: '', steps: [{ stepType: 'replace' }] })
    await store.flush(sessionId)

    // Skipping the write would leave "It rained" on disk, showing a draft that no longer matches
    // anything the writer can see.
    expect(await draftRepository.list()).toEqual([])
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
