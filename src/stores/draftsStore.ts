import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { isBlankDraft, isEmptyDocument } from '@/domain/entryDocument'
import { currentVersionId } from '@/domain/reconstructEntryState'
import { TraceRecorder } from '@/domain/traceRecorder'
import { draftRepository } from '@/repositories'
import { DraftConflictError, type PersistedEvents } from '@/repositories/draftRepository'
import {
  draftFieldsOf,
  newDraftEntry,
  toSnapshot,
  versionsRevisedBy,
  withEvents,
  type Draft,
  type DraftDocument,
  type DraftSnapshot,
} from '@/types/draft'
import {
  newEntryId,
  newEntryTimestamp,
  type AggregatedEntry,
  type ChangeSignals,
  type Entry,
  type EntryDates,
} from '@/types/entry'
import { toErrorMessage } from '@/utils/format'
import { useEntriesStore } from './entriesStore'

/**
 * How long typing may go unpersisted. Short enough that a crash costs a fraction of a sentence,
 * long enough that a fast typist is not writing to disk on every keystroke. Autosave, unrelated to
 * marks: flushing is about never losing work.
 */
export const DRAFT_FLUSH_MS = 300

/**
 * What one editor change tells the buffer. `ChangeSignals` are optional — a caller focused on the
 * body alone, most tests among them, has nothing to say about them.
 */
export interface DraftChange extends Partial<ChangeSignals> {
  /** The document as it now stands. */
  content: string
  /**
   * The title field as it now stands, when the editor offers one; null when it doesn't. Optional
   * because a caller focused on the body alone — most tests among them — has nothing to say about
   * it; omitting it reads as "unchanged from null," the same way a fresh buffer starts.
   */
  title?: string | null
  /** Serialized ProseMirror steps for this change. The session never interprets them. */
  steps?: unknown[]
}

/**
 * What a session starts from. Revising or relating to an entry starts from its aggregate, the
 * current version, which is where the draft's base version and its seeded fields come from.
 */
export type DraftStart =
  | { kind: 'new_root' }
  | { kind: 'new_related'; parent: AggregatedEntry }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent: AggregatedEntry }

/**
 * What another tab did to a draft open here, for the session showing it to catch up on. `count`
 * rises each time; `gone` means it was sealed or discarded there; `unsaved` is the document this
 * tab held that couldn't be kept, for the writer to copy from.
 */
export interface ChangedElsewhere {
  count: number
  gone: boolean
  unsaved: string | null
}

/**
 * A stored draft no trace can carry on from, because its start time won't parse. Its words are on
 * disk but out of reach, so discarding is the only way forward.
 */
export class DraftUnreadableError extends Error {
  constructor() {
    super(
      'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
    )
    this.name = 'DraftUnreadableError'
  }
}

interface ActiveSession {
  /** Every event log lives in the recorders, joined to this only by `materialize`. */
  draft: DraftSnapshot
  recorder: TraceRecorder
  /** The parent document's log, present exactly when the draft has a `parent`. */
  parentRecorder: TraceRecorder | null
  timer: ReturnType<typeof setTimeout> | null
  /** True once anything has actually been typed, so an opened-and-abandoned composer saves nothing. */
  dirty: boolean
  /** Whether a row for this session exists on disk, so an emptied draft knows to remove it. */
  persisted: boolean
  /**
   * The stored row's `updated_at` as this tab last read or wrote it. A row that says otherwise was
   * written by another tab since.
   */
  storedAt: string | null
  /**
   * How much of each event log the store already holds, so the next flush's `save` appends only
   * the tail. Advanced only after a successful write — see `flush` — and reset to zero the moment
   * a write deletes the row instead, or the counts and what's actually stored would drift apart.
   */
  persistedEvents: PersistedEvents
  /**
   * The repository write `flush` is currently awaiting, if any. Cancelling the timer stops a
   * flush that hasn't started; it does nothing for one already mid-write. Sealing or discarding
   * must wait on this too, or a write that resolves after `delete()` has already run would
   * resurrect the row it just removed.
   */
  flushing: Promise<void> | null
}

export const useDraftsStore = defineStore('drafts', () => {
  const drafts = shallowRef<DraftSnapshot[]>([])
  const error = ref<string | null>(null)
  /** Per open session, what another tab has done to its draft — see `adoptStored`. */
  const elsewhere = shallowRef<Record<string, ChangedElsewhere>>({})

  // Not reactive: this holds timers and trace recorders, none of which a template reads, and
  // a Vue proxy over the draft would not survive structuredClone on its way into the repository.
  const active = new Map<string, ActiveSession>()
  let adopting: Promise<void> | null = null

  /**
   * Opens a session. One for a new entry writes nothing yet: a composer someone opened and walked
   * away from is not a draft, and a drafts list full of empty rows would defeat the point of having one.
   * A session that could revise an entry is written at once instead, as a claim every tab can see
   * before a word is typed, so another tab resumes it rather than beginning a second draft on the
   * same version. `abandonDraft` releases it if nothing comes of it.
   */
  function beginDraft(start: DraftStart): string {
    const sessionId = newEntryId()
    const snapshot = startingSnapshot(start, sessionId, newEntryTimestamp())
    const entry = open(withEvents(snapshot, { entry: [], parent: [] }), false)

    active.set(sessionId, entry)
    if (claimsEntry(snapshot)) {
      entry.dirty = true
      void flush(sessionId)
    }
    return sessionId
  }

  /**
   * Reopens a draft with its event logs intact, always as disk has it: another tab may have
   * carried it on since this one last held it. Anything this tab still holds is written first, so
   * the read includes it; if that write fails, what this tab holds is all there is.
   */
  async function resumeDraft(sessionId: string): Promise<Draft | null> {
    if (active.has(sessionId)) await letGo(sessionId)
    const unwritten = active.get(sessionId)
    if (unwritten) return structuredClone(materialize(unwritten))

    const draft = await draftRepository.getById(sessionId)
    if (!draft) return null

    // Nothing new to write until this session is typed in, but the row is already on disk, so
    // emptying it later has something to delete.
    active.set(sessionId, open(draft, true))
    return structuredClone(draft)
  }

  /** Holds a draft open: its snapshot, and a recorder per document carrying on from its log. */
  function open(draft: Draft, persisted: boolean): ActiveSession {
    const recorderFor = (document: DraftDocument) => {
      try {
        return TraceRecorder.resume(
          draft.session_id,
          draft.started_at,
          document.base_content,
          document.events,
        )
      } catch {
        throw new DraftUnreadableError()
      }
    }

    return {
      draft: toSnapshot(draft),
      recorder: recorderFor(draft.entry),
      parentRecorder: draft.kind === 'new_related' ? recorderFor(draft.parent) : null,
      timer: null,
      dirty: false,
      persisted,
      storedAt: persisted ? draft.updated_at : null,
      // Whatever a draft arrives with is, by definition, already stored.
      persistedEvents: eventCounts(draft),
      flushing: null,
    }
  }

  /**
   * Appends a change into a `TraceRecorder` — shared by `recordChange` (the entry's own prose) and
   * `recordParentChange` (the parent's provisional document in an anchor-mode session), so both
   * streams are recorded exactly the same way. Anchor mode limits what the *editor* can produce
   * (ENTRY_MODEL.md, "Two creation experiences, kept separate"); this is the recorder that takes
   * whatever it does produce, and it has no notion of which mode a change came from.
   *
   * A change with no steps did not touch the traced document — a retitling is the one that does
   * this for `recordChange`, since the title is a plain field beside the editor rather than part of
   * it. It is skipped entirely: an event for it would let a policy mark a stream for something that
   * never entered it.
   */
  function recordInto(recorder: TraceRecorder, change: DraftChange): void {
    if ((change.steps ?? []).length === 0) return

    recorder.record({ ...change, steps: change.steps ?? [] })
  }

  /**
   * Records a change and schedules a flush. The buffer is append-only while the session runs:
   * events accumulate and nothing already recorded is rewritten, so no authoring history is lost by
   * design. Only the snapshot moves.
   */
  function recordChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)
    recordInto(entry.recorder, change)

    const { draft } = entry
    entry.draft = {
      ...draft,
      updated_at: newEntryTimestamp(),
      entry: { ...draft.entry, content: change.content, title: change.title ?? null },
    }
    entry.dirty = true

    scheduleFlush(sessionId)
  }

  /**
   * Records a change to the **parent's** provisional document, for an anchor-mode session only —
   * an ordinary `DraftChange` like the entry's own, against the session's second document. Which
   * anchors the session has placed is nowhere in here: it is the difference between
   * `parent.base_content` and `parent.content` (`anchorsPlacedSince`), read when someone asks.
   */
  function recordParentChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)
    const { draft, parentRecorder } = entry
    if (draft.kind !== 'new_related' || !parentRecorder) {
      throw new Error('recordParentChange called on a session with no parent document')
    }

    recordInto(parentRecorder, change)

    entry.draft = {
      ...draft,
      updated_at: newEntryTimestamp(),
      parent: { ...draft.parent, content: change.content },
    }
    entry.dirty = true

    scheduleFlush(sessionId)
  }

  /**
   * Records the dates typed alongside the words. Spread into a plain object rather than stored by
   * reference: these arrive from a form's reactive state, and a Vue proxy does not survive the
   * `structuredClone` on the way into the repository.
   */
  function recordDates(sessionId: string, dates: EntryDates): void {
    const entry = requireActive(sessionId)
    const { draft } = entry

    entry.draft = {
      ...draft,
      updated_at: newEntryTimestamp(),
      entry: { ...draft.entry, dates: { ...dates } },
    }
    entry.dirty = true

    scheduleFlush(sessionId)
  }

  /** A mark the writer asked for, rather than one a policy finds. */
  function addMark(sessionId: string): void {
    const entry = requireActive(sessionId)

    entry.recorder.mark()
    entry.dirty = true
    scheduleFlush(sessionId)
  }

  /**
   * Builds the whole draft from its snapshot and the recorders' live event logs — the one place
   * those logs are read, right before something needs the whole draft. Keeping it out of the
   * per-change paths matters because `TraceRecorder.events` hands back a defensive copy, so reading
   * it on every keystroke would clone the entire log each time.
   *
   * Always fresh documents, never the snapshot's by reference, so a draft already handed to an
   * in-flight `save()` can't be mutated out from under it.
   */
  function materialize(entry: ActiveSession): Draft {
    return withEvents(entry.draft, {
      entry: entry.recorder.events,
      parent: entry.parentRecorder?.events ?? [],
    })
  }

  /**
   * Writes the pending snapshot now, cancelling any scheduled flush, and resolves once everything
   * this tab holds is on disk, including a write already under way.
   *
   * An empty new entry never reaches disk. A draft is a piece of writing in progress, and a row
   * holding no writing is noise in the drafts list at best and a false promise of recoverable work
   * at worst. Emptying one that had words *deletes* its row rather than skipping the write, because
   * leaving the last non-empty snapshot behind would show a draft that no longer matches anything
   * the writer can see. A claim on an entry is the exception: it stays while its session is open,
   * however empty, and is judged when the session ends (`abandonDraft`).
   */
  async function flush(sessionId: string): Promise<void> {
    const entry = active.get(sessionId)
    if (!entry) return

    cancelFlush(entry)
    const previous = entry.flushing
    if (!entry.dirty) {
      await previous?.catch(() => {})
      return
    }
    entry.dirty = false

    const write = (async () => {
      // One write at a time: each appends events from where the last one's left off. One that
      // lost to another tab has already replaced this session with what disk holds.
      await previous?.catch(() => {})
      if (active.get(sessionId) !== entry) return
      const draft = materialize(entry)

      if (!claimsEntry(draft) && isBlankDraft(draft.entry.content, draft.entry.title)) {
        if (entry.persisted) {
          await draftRepository.delete(sessionId)
          entry.persisted = false
          entry.storedAt = null
          // The row and its events are both gone; the next save must start the log over.
          entry.persistedEvents = { entry: 0, parent: 0 }
        }
        return
      }

      await draftRepository.save(draft, entry.persistedEvents)
      entry.persisted = true
      entry.storedAt = draft.updated_at
      entry.persistedEvents = eventCounts(draft)
    })()

    entry.flushing = write
    try {
      await write
    } catch (err) {
      if (err instanceof DraftConflictError) {
        // Another tab wrote this draft since this one last did. Its version stands, and what this
        // tab had is offered for copying rather than written over it.
        await adoptStored(sessionId, entry.draft.entry.content)
        return
      }

      // The snapshot never reached disk, so it is still pending. `dirty` was cleared optimistically
      // above to keep a burst of typing from queueing a second write of the same state; leaving it
      // cleared after a failure would retire these words unwritten, and a session that has stopped
      // typing would never try again. Restoring it means the next flush — the next keystroke, or
      // the composer closing — carries them.
      //
      // Deliberately not rescheduling here: a permanently full disk would turn that into a write
      // attempt every 300ms for as long as the tab is open. And deliberately not rethrown, since
      // every caller reaches this through `void flush(...)` or a fire-and-forget abandon, where a
      // rejection becomes an unhandled one rather than anything anybody sees.
      entry.dirty = true
      error.value = toErrorMessage(err, 'Failed to save draft')
    } finally {
      if (entry.flushing === write) entry.flushing = null
    }
  }

  /**
   * The explicit user action that ends a session: the immutable entries holding the final snapshot
   * and the completed traces, written in the same transaction that removes the draft. Never an idle
   * timeout — until someone seals, the work stays a draft, recoverable and absent from every
   * timeline. A refused seal keeps the session open and its draft on disk.
   */
  async function sealDraft(sessionId: string): Promise<Entry> {
    const entry = requireActive(sessionId)
    cancelFlush(entry)
    // A flush already mid-write must finish before the seal removes this session's row, or its
    // resolution could land after and resurrect a draft for content that is already an entry.
    await entry.flushing?.catch(() => {})

    if (isEmptyDocument(entry.draft.entry.content)) {
      throw new Error('Entry content cannot be empty')
    }

    error.value = null
    const entries = useEntriesStore()

    let written: Entry[]
    try {
      const inputs = await entries.inputsForDraft(
        entry.draft,
        entry.recorder.seal(),
        entry.parentRecorder?.seal() ?? null,
      )
      written = await draftRepository.seal(sessionId, inputs)
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to save entry')
      // Whatever was typed since the last flush still has to reach disk.
      if (entry.dirty) scheduleFlush(sessionId)
      throw err
    }

    active.delete(sessionId)

    // The save has landed; a list that fails to refresh after it doesn't make it a failure.
    try {
      await entries.showWritten(written)
      await loadDrafts()
    } catch (err) {
      error.value = toErrorMessage(err, 'Saved, but failed to refresh')
    }

    return written[written.length - 1]!
  }

  /**
   * Called when whatever opened a session goes away — a composer unmounted, a page navigated from
   * — without the user explicitly saving or discarding. Real work is left exactly as `flush` leaves
   * it: a resumable draft, since closing a tab must not discard it. The session itself is let go
   * once everything typed is on disk, so resuming later reads it back from there, along with
   * anything another tab added since. A failed write keeps it, or its words would go with it. A
   * claim on an entry that nothing came of is released, so the entry is free to revise again.
   */
  async function abandonDraft(sessionId: string): Promise<void> {
    const entry = await letGo(sessionId)
    if (entry && claimsEntry(entry.draft)) await releaseIfEmpty(sessionId)
  }

  /** Writes what a session holds, then drops it from memory. Returns it, or null if it was kept. */
  async function letGo(sessionId: string): Promise<ActiveSession | null> {
    await flush(sessionId)

    const entry = active.get(sessionId)
    if (!entry || entry.dirty) return null
    active.delete(sessionId)
    return entry
  }

  /**
   * Removes a claim that holds no work. Judged by what disk holds rather than this tab's copy:
   * another tab may have resumed the draft and written in it since.
   */
  async function releaseIfEmpty(sessionId: string): Promise<void> {
    try {
      const stored = await draftRepository.getById(sessionId)
      if (!stored || (await useEntriesStore().draftHoldsWork(stored))) return

      await draftRepository.delete(sessionId)
      await loadDrafts()
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to release draft')
    }
  }

  /** Writes everything pending now, for a tab being left: whatever opens a draft next reads disk. */
  async function flushAll(): Promise<void> {
    await Promise.all([...active.keys()].map((sessionId) => flush(sessionId)))
  }

  /**
   * Catches every open session up with disk, for a tab being returned to: a draft another tab has
   * written since is reloaded, and one sealed or discarded there is closed. Only sessions already
   * on disk are asked about; one never written can't have been opened anywhere else. One read of
   * the snapshots covers them all, since drafts are few and none of their logs are needed to tell,
   * and it refreshes the drafts list too, so an entry another tab has claimed offers its draft.
   */
  function adoptChangesElsewhere(): Promise<void> {
    // A return fires visibility and focus together; one check answers both.
    adopting ??= catchUpWithDisk().finally(() => {
      adopting = null
    })
    return adopting
  }

  async function catchUpWithDisk(): Promise<void> {
    const open = [...active.entries()].filter(([, entry]) => entry.persisted)

    // A write of this tab's still landing would read as someone else's.
    await Promise.all(open.map(([, entry]) => entry.flushing?.catch(() => {})))

    try {
      drafts.value = await draftRepository.list()
      const stored = new Map(drafts.value.map((row) => [row.session_id, row.updated_at]))
      for (const [sessionId, entry] of open) {
        if (stored.get(sessionId) === entry.storedAt) continue
        await adoptStored(sessionId, entry.dirty ? entry.draft.entry.content : null)
      }
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to check drafts')
    }
  }

  /**
   * Replaces an open session with what disk holds, or closes it if disk holds nothing, because
   * another tab has written it. The session showing it catches up through `elsewhere`. `unsaved`
   * is the document this tab had that disk didn't take.
   */
  async function adoptStored(sessionId: string, unsaved: string | null): Promise<void> {
    const current = active.get(sessionId)
    if (current) cancelFlush(current)

    try {
      const stored = await draftRepository.getById(sessionId)
      if (stored) active.set(sessionId, open(stored, true))
      else active.delete(sessionId)

      const count = (elsewhere.value[sessionId]?.count ?? 0) + 1
      elsewhere.value = { ...elsewhere.value, [sessionId]: { count, gone: !stored, unsaved } }
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to reload draft')
    }
  }

  /** Throws the session away. The one thing that ever removes work, and only on request. */
  async function discardDraft(sessionId: string): Promise<void> {
    const entry = active.get(sessionId)
    if (entry) {
      cancelFlush(entry)
      // Same reasoning as sealDraft: let a flush already mid-write land before the row it holds
      // is deleted, or it can resurrect what's being discarded.
      await entry.flushing?.catch(() => {})
    }

    active.delete(sessionId)
    await draftRepository.delete(sessionId)
    await loadDrafts()
  }

  /**
   * The drafts list. It exists because a draft can live indefinitely, so without somewhere to see
   * them, an unsealed session would be stranded where nothing in the app ever mentions it again.
   */
  async function loadDrafts(): Promise<void> {
    error.value = null

    try {
      drafts.value = await draftRepository.list()
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to load drafts')
      throw err
    }
  }

  /** The in-progress snapshot, without waiting for it to reach disk. */
  function currentDraft(sessionId: string): Draft | null {
    const entry = active.get(sessionId)
    return entry ? structuredClone(materialize(entry)) : null
  }

  function scheduleFlush(sessionId: string): void {
    const entry = requireActive(sessionId)
    if (entry.timer !== null) return

    // A throttle, not a debounce: later keystrokes don't restart the timer, so continuous typing
    // still writes every DRAFT_FLUSH_MS rather than waiting for a pause that may never come.
    entry.timer = setTimeout(() => {
      entry.timer = null
      void flush(sessionId)
    }, DRAFT_FLUSH_MS)
  }

  function cancelFlush(entry: ActiveSession): void {
    if (entry.timer === null) return

    clearTimeout(entry.timer)
    entry.timer = null
  }

  function requireActive(sessionId: string): ActiveSession {
    const entry = active.get(sessionId)
    if (!entry) {
      throw new Error(`No open draft session ${sessionId}`)
    }
    return entry
  }

  return {
    drafts,
    error,
    elsewhere,
    beginDraft,
    resumeDraft,
    recordChange,
    recordParentChange,
    recordDates,
    addMark,
    flush,
    flushAll,
    adoptChangesElsewhere,
    abandonDraft,
    sealDraft,
    discardDraft,
    loadDrafts,
    currentDraft,
  }
})

/**
 * A new session's snapshot. Revising starts from a copy of the current version, so whatever the
 * writer leaves alone saves unchanged. Each `base_*` starts equal to what it describes and never
 * moves: it is what a trace replays from, and for the parent also what `anchorsPlacedSince` diffs
 * against.
 */
function startingSnapshot(start: DraftStart, sessionId: string, startedAt: string): DraftSnapshot {
  const header = { session_id: sessionId, started_at: startedAt, updated_at: startedAt }

  switch (start.kind) {
    case 'new_root':
      return { ...header, kind: start.kind, entry: newDraftEntry() }
    case 'new_connection':
      return {
        ...header,
        kind: start.kind,
        parent_id: start.parent_id,
        target_id: start.target_id,
        entry: newDraftEntry(),
      }
    case 'new_related':
      return {
        ...header,
        kind: start.kind,
        parent_id: start.parent.id,
        entry: newDraftEntry(),
        parent: startingDocument(start.parent),
      }
    case 'revision':
      return {
        ...header,
        kind: start.kind,
        parent_id: start.parent.id,
        entry: { ...startingDocument(start.parent), ...draftFieldsOf(start.parent) },
      }
  }
}

/** Whether a draft holds an entry against other drafts while open (PRODUCT.md §4.8). */
function claimsEntry(draft: DraftSnapshot): boolean {
  return versionsRevisedBy(draft).length > 0
}

/** An existing entry's document as a session finds it: its current version. */
function startingDocument(entry: AggregatedEntry): Omit<DraftDocument, 'events'> {
  return {
    base_version_id: currentVersionId(entry),
    base_content: entry.content,
    content: entry.content,
  }
}

/** How long each of a draft's event logs is. */
function eventCounts(draft: Draft): PersistedEvents {
  return {
    entry: draft.entry.events.length,
    parent: draft.kind === 'new_related' ? draft.parent.events.length : 0,
  }
}
