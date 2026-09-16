import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { docToPlainText, textContent } from '@/domain/entryDocument'
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
import { createEntryInput, emptyEntryDates } from '@/types/entry'

describe('useDraftsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Fresh in-memory adapters per test. The Dexie ones get their own persistence proof in
    // dexieDraftRepository.browser.test.ts; the store only needs to prove it talks to whatever
    // the composition root points at.
    setEntryRepository(new InMemoryEntryRepository())
    setDraftRepository(new InMemoryDraftRepository())
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
    expect(docToPlainText(flushed!.content)).toBe('It rained all day.')
    expect(flushed?.steps).toHaveLength(3)
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
      content: textContent('We drove up on Friday', 'Lake Tahoe'),
      steps: [],
    })

    await vi.advanceTimersByTimeAsync(DRAFT_FLUSH_MS)

    const flushed = await draftRepository.getById(sessionId)
    expect(flushed?.content).toBe(textContent('We drove up on Friday', 'Lake Tahoe'))
    expect(flushed?.steps).toHaveLength(1)
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

    expect(docToPlainText((await draftRepository.getById(sessionId))!.content)).toBe(
      'It rained all day.',
    )
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
    expect(flushed?.dates).toEqual({
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
    const content = textContent('We drove up on Friday.', 'Lake Tahoe')

    store.recordChange(sessionId, {
      content,
      steps: [{ stepType: 'replace' }],
      insertedText: 'We drove up on Friday.',
    })
    const sealed = await store.sealDraft(sessionId)

    const stored = await entries.getEntry(sealed.id)
    expect(stored?.title).toBe('Lake Tahoe')
    expect(stored?.authoring_trace?.session_id).toBe(sessionId)
    expect(stored?.authoring_trace?.ticks.map((tick) => tick.reason)).toEqual(['punctuation'])
    expect(await draftRepository.getById(sessionId)).toBeNull()
    expect(store.drafts).toEqual([])
  })

  it('seals an anchor-mode draft as a parent revision plus a child referencing its anchor', async () => {
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent(parentContent) }),
    )

    const sessionId = store.beginDraft(
      { kind: 'new_child', parent_id: parent.id },
      { parentContent: textContent(parentContent) },
    )
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

    const child = await entryRepository.getById(sealed.id)
    expect(child?.parent_id).toBe(parent.id)
    expect(child?.relation_type).toBe('annotation')
    expect(child?.anchors).toEqual([{ anchor_id: 'anchor-1', quote: 'meeting' }])

    // The parent gained a revision carrying the anchor, rather than the anchor sitting only on
    // the child — an anchor's position is a fact about the parent's document (ENTRY_MODEL.md).
    const revisions = await entryRepository.listRevisions(parent.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.revision_mode).toBe('anchor')
    expect(revisions[0]?.content).toBe(markedParentContent)
  })

  it('records an anchor op into the parent stream as a tick, the same way the child stream would', async () => {
    // One authoring pipeline, not two (CLAUDE.md, "anchor mode limits what the editor allows, not
    // what the authoring session records"): `recordParentChange` and `recordChange` both have to
    // reach the same `AuthoringSession.record`, so a structural anchor op bookmarks the parent's
    // own chain exactly the way it would the child's.
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent(parentContent) }),
    )

    const sessionId = store.beginDraft(
      { kind: 'new_child', parent_id: parent.id },
      { parentContent: textContent(parentContent) },
    )
    store.recordParentChange(sessionId, {
      content: withAnchorMark(parentContent, 'anchor-1', 4, 11),
      steps: [{ stepType: 'addMark' }],
      isAnchorOp: true,
    })
    store.recordChange(sessionId, {
      content: textContent('It was salvaged later.'),
      steps: [{ stepType: 'replace' }],
    })
    const sealed = await store.sealDraft(sessionId)

    const [parentRevision] = await entryRepository.listRevisions(parent.id)
    expect(parentRevision?.authoring_trace?.ticks.map((tick) => tick.reason)).toEqual(['anchor'])
    expect((await entryRepository.getById(sealed.id))?.authoring_trace).toBeTruthy()
  })

  it('carries the parent’s own ticks through a resume, not only its steps', async () => {
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent(parentContent) }),
    )
    const markedParentContent = withAnchorMark(parentContent, 'anchor-1', 4, 11)

    await draftRepository.save({
      session_id: 'interrupted-anchor',
      target: { kind: 'new_child', parent_id: parent.id },
      started_at: '2026-09-05T10:00:00.000Z',
      updated_at: '2026-09-05T10:00:02.000Z',
      content: '',
      dates: emptyEntryDates(),
      parent_base_content: textContent(parentContent),
      parent_content: markedParentContent,
      steps: [],
      parent_steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'addMark' } }],
      ticks: [],
      parent_ticks: [{ at: '2026-09-05T10:00:01.000Z', step_index: 1, reason: 'anchor' }],
    })

    await store.resumeDraft('interrupted-anchor')
    store.recordChange('interrupted-anchor', {
      content: textContent('Worth revisiting.'),
      steps: [{ stepType: 'replace' }],
    })
    await store.sealDraft('interrupted-anchor')

    const [parentRevision] = await entryRepository.listRevisions(parent.id)
    // Resumed intact, not restarted: the tick recorded before the reload is still there, at the
    // same `step_index` its one prior step earned it.
    expect(parentRevision?.authoring_trace?.ticks).toEqual([
      expect.objectContaining({ step_index: 1, reason: 'anchor' }),
    ])
  })

  it('records nothing into the parent stream for a change with no steps', async () => {
    const store = useDraftsStore()
    const parentContent = 'The meeting went badly'
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent(parentContent) }),
    )

    const sessionId = store.beginDraft(
      { kind: 'new_child', parent_id: parent.id },
      { parentContent: textContent(parentContent) },
    )
    // A stray update with nothing on the transaction — no step for the trace to append and no
    // moment for the tick policy to judge.
    store.recordParentChange(sessionId, { content: textContent(parentContent), steps: [] })
    store.recordChange(sessionId, {
      content: textContent('Nothing marked.'),
      steps: [{ stepType: 'replace' }],
    })
    await store.flush(sessionId)

    expect(store.currentDraft(sessionId)?.parent_steps).toEqual([])
    expect(store.currentDraft(sessionId)?.parent_ticks).toEqual([])
  })

  it('seals a revision draft as a new version rather than touching the entry it edits', async () => {
    const store = useDraftsStore()
    const entries = useEntriesStore()
    const original = await entries.createTextEntry('I recieved the offer')

    const sessionId = store.beginDraft({ kind: 'revision', parent_id: original.id })
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

  it('resumes a draft left behind by a reload with its history intact', async () => {
    const store = useDraftsStore()
    await draftRepository.save({
      session_id: 'interrupted',
      target: { kind: 'new_root' },
      started_at: '2026-09-05T10:00:00.000Z',
      updated_at: '2026-09-05T10:00:02.000Z',
      content: textContent('Half a thought'),
      dates: emptyEntryDates(),
      parent_base_content: null,
      parent_content: null,
      steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'replace' } }],
      parent_steps: [],
      ticks: [{ at: '2026-09-05T10:00:01.000Z', step_index: 1, reason: 'punctuation' }],
      parent_ticks: [],
    })

    const resumed = await store.resumeDraft('interrupted')
    store.recordChange('interrupted', {
      content: textContent('Half a thought, finished.'),
      steps: [{ stepType: 'replace' }],
    })
    const sealed = await store.sealDraft('interrupted')

    expect(docToPlainText(resumed!.content)).toBe('Half a thought')
    const trace = (await useEntriesStore().getEntry(sealed.id))?.authoring_trace
    expect(trace?.started_at).toBe('2026-09-05T10:00:00.000Z')
    expect(trace?.steps).toHaveLength(2)
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

    expect(store.drafts.map((draft) => docToPlainText(draft.content))).toEqual(['Newer', 'Older'])
  })

  it('abandons an untouched session outright, rather than leaving it open forever', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })

    await store.abandonDraft(sessionId)

    expect(store.currentDraft(sessionId)).toBeNull()
  })

  it('flushes and keeps a session that was actually typed into when abandoned', async () => {
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })
    store.recordChange(sessionId, {
      content: textContent('Half a thought'),
      steps: [{ stepType: 'replace' }],
    })

    await store.abandonDraft(sessionId)

    expect(docToPlainText(store.currentDraft(sessionId)!.content)).toBe('Half a thought')
    expect(await draftRepository.getById(sessionId)).not.toBeNull()
  })

  it('does not resurrect a draft when sealing races an in-flight flush', async () => {
    vi.useFakeTimers()
    const store = useDraftsStore()
    const sessionId = store.beginDraft({ kind: 'new_root' })
    store.recordChange(sessionId, {
      content: textContent('A day at the lake'),
      steps: [{ stepType: 'replace' }],
    })

    // Let the debounced flush actually start its write, but hold it open so sealing can race it
    // — this is exactly the window the fix has to close.
    const originalSave = draftRepository.save.bind(draftRepository)
    let releaseSave: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    vi.spyOn(draftRepository, 'save').mockImplementationOnce(async (draft) => {
      await held
      return originalSave(draft)
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
    expect(docToPlainText(store.currentDraft(sessionId)!.content)).toBe('   ')
  })
})
