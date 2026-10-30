import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { isBlankDraft, isEmptyDocument } from '@/domain/entryDocument'
import { currentVersionId } from '@/domain/reconstructEntryState'
import { TraceRecorder } from '@/domain/traceRecorder'
import { draftRepository } from '@/repositories'
import { DraftConflictError } from '@/repositories/draftRepository'
import {
  type Draft,
  type DraftDocument,
  draftFieldsOf,
  type DraftSnapshot,
  newDraftEntry,
  toSnapshot,
  versionsRevisedBy,
  withEvents,
} from '@/types/draft'
import {
  type AggregatedEntry,
  type AuthoringEvent,
  type ChangeSignals,
  type Entry,
  type EntryDetails,
  entryDetailsOf,
} from '@/types/entry'
import { toErrorMessage } from '@/utils/format'
import { newId, newTimestamp } from '@/utils/id'

import { useEntriesStore } from './entriesStore'

/**
 * How long typing may go unpersisted. Short enough that a crash costs a fraction of a sentence,
 * long enough that a fast typist is not writing to disk on every keystroke. Autosave, unrelated to
 * marks: flushing is about never losing work.
 */
export const DRAFT_FLUSH_MS = 300

/** What one editor change tells the buffer. */
export interface DraftChange extends ChangeSignals {
  /** The document as it now stands. */
  content: string
  /** The title field as it now stands, when the editor offers one; null when it doesn't. */
  title: string | null
  /** Serialized ProseMirror steps for this change. The session never interprets them. */
  steps: unknown[]
}

/**
 * What a session starts from. Revising or relating to an entry starts from its aggregate, the
 * current version, which is where the draft's base version and its seeded fields come from.
 */
export type BeginDraftInput =
  | { kind: 'new_root' }
  | { kind: 'new_related'; parent: AggregatedEntry }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent: AggregatedEntry }

/**
 * What another tab did to a draft open here, for the session showing it to catch up on. `gone`
 * means it was sealed or discarded there; `unsaved` is the snapshot this tab held that couldn't be
 * kept, for the writer to copy from. Each one is a new object, which is how a watcher tells it from
 * the last.
 */
interface ChangeElsewhere {
  gone: boolean
  unsaved: DraftSnapshot | null
}

/**
 * A stored draft no trace can carry on from, because its start time won't parse. Its words are on
 * disk but out of reach, so discarding is the only way forward; `draft` holds them for copying first.
 */
export class DraftUnreadableError extends Error {
  constructor(readonly draft: DraftSnapshot) {
    super(
      'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
    )
    this.name = 'DraftUnreadableError'
  }
}

interface ActiveSession {
  /**
   * Every event log lives in the recorders, joined to this only by `materialize`. Its `write_id`
   * is the stored write this tab last read or made, null while nothing is on disk.
   */
  draft: DraftSnapshot
  recorder: TraceRecorder
  /** The parent document's log, present exactly when the draft has a `parent`. */
  parentRecorder: TraceRecorder | null
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  /**
   * This session's writes, each queued behind the last. Sealing and discarding wait on it, since
   * cancelling the timer only stops a write not yet queued: a first write landing after would
   * recreate the row, and a later one would refuse the seal or discard as a conflict.
   */
  flushing: Promise<void>
}

/** An existing entry's document as a session finds it: its current version. */
function startingDocument(entry: AggregatedEntry): Omit<DraftDocument, 'events'> {
  return {
    base_version_id: currentVersionId(entry),
    content: entry.content,
  }
}

/**
 * A new session's snapshot. Revising starts from a copy of the current version, so whatever the
 * writer leaves alone saves unchanged. Each `base_version_id` names the version its document starts
 * from and never moves: that version is what a trace replays from, and for the parent also what
 * `anchorsPlacedSince` diffs against.
 */
function startingSnapshot(
  start: BeginDraftInput,
  sessionId: string,
  startedAt: string,
): DraftSnapshot {
  const header = {
    session_id: sessionId,
    started_at: startedAt,
    updated_at: startedAt,
    write_id: null,
  }

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

/** Holds a draft open: its snapshot, and a recorder per document carrying on from its log. */
function open(draft: Draft): ActiveSession {
  const recorderFor = (events: AuthoringEvent[]) => {
    try {
      return TraceRecorder.resume(draft.session_id, draft.started_at, events)
    } catch {
      throw new DraftUnreadableError(toSnapshot(draft))
    }
  }

  return {
    draft: toSnapshot(draft),
    recorder: recorderFor(draft.entry.events),
    parentRecorder: draft.kind === 'new_related' ? recorderFor(draft.parent.events) : null,
    timer: null,
    dirty: false,
    flushing: Promise.resolve(),
  }
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

function cancelFlush(entry: ActiveSession): void {
  if (entry.timer === null) return

  clearTimeout(entry.timer)
  entry.timer = null
}

export const useDraftsStore = defineStore('drafts', () => {
  const drafts = shallowRef<DraftSnapshot[]>([])
  const error = ref<string | null>(null)
  /** Per session, the latest change another tab made since this tab opened it (`adoptStored`). */
  const changedElsewhere = shallowRef<Record<string, ChangeElsewhere>>({})

  /**
   * Not reactive: this holds timers and trace recorders, none of which a template reads, and
   * a Vue proxy over the draft would not survive structuredClone on its way into the repository.
   */
  const active = new Map<string, ActiveSession>()
  let adopting: Promise<void> | null = null

  /** Resolves once every write this tab has under way has landed, so a read of disk includes it. */
  async function writesLanded(): Promise<void> {
    await Promise.all([...active.values()].map((entry) => entry.flushing))
  }

  /**
   * The drafts list. It exists because a draft can live indefinitely, so without somewhere to see
   * them, an unsealed session would be stranded where nothing in the app ever mentions it again.
   * Read once this tab's own writes land, or a row would name a write before them, and discarding
   * it from here would be refused.
   */
  async function loadDrafts(): Promise<void> {
    error.value = null

    try {
      await writesLanded()
      drafts.value = await draftRepository.list()
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to load drafts')
      throw err
    }
  }

  /**
   * Replaces an open session with what disk holds, or closes it if disk holds nothing, because
   * another tab has written it. The session showing it catches up through `changedElsewhere`.
   * `unsaved` is the snapshot this tab had that disk didn't take.
   */
  async function adoptStored(sessionId: string, unsaved: DraftSnapshot | null): Promise<void> {
    const current = active.get(sessionId)
    if (current) cancelFlush(current)

    try {
      const stored = await draftRepository.getById(sessionId)
      if (stored) active.set(sessionId, open(stored))
      else active.delete(sessionId)

      const change = { gone: !stored, unsaved }
      changedElsewhere.value = { ...changedElsewhere.value, [sessionId]: change }
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to reload draft')
    }
  }

  /**
   * One queued write of what a session holds, or a delete once a new entry is emptied, so the
   * drafts list shows only writing someone can see. Never rejects: a rejection would skip every
   * write queued after it, and the session would silently stop saving.
   */
  async function write(sessionId: string, entry: ActiveSession): Promise<void> {
    // One that lost to another tab has already replaced this session with what disk holds.
    if (active.get(sessionId) !== entry) return

    try {
      const draft = materialize(entry)

      // Each write's id goes on the snapshot as it is by then: one replaced while the write was
      // under way still carries the id it was built on.
      if (!claimsEntry(draft) && isBlankDraft(draft.entry.content, draft.entry.title)) {
        if (draft.write_id !== null) {
          await draftRepository.delete(sessionId, draft.write_id)
          entry.draft = { ...entry.draft, write_id: null }
        }
        return
      }

      const writeId = await draftRepository.save(draft)
      entry.draft = { ...entry.draft, write_id: writeId }
    } catch (err) {
      if (err instanceof DraftConflictError) {
        // Another tab wrote this draft since this one last did. Its version stands, and what this
        // tab had is offered for copying rather than written over it.
        await adoptStored(sessionId, entry.draft)
        return
      }

      // Still pending, for the next flush to carry. Not rescheduled, or a full disk would retry
      // every DRAFT_FLUSH_MS for as long as the tab is open.
      entry.dirty = true
      error.value = toErrorMessage(err, 'Failed to save draft')
    }
  }

  /**
   * Queues a write of what a session holds, without waiting for its timer, and resolves once every
   * write it has queued has landed.
   */
  async function flush(sessionId: string): Promise<void> {
    const entry = active.get(sessionId)
    if (!entry) return

    cancelFlush(entry)
    if (entry.dirty) {
      entry.dirty = false
      // The queue's new tail: runs once the last write settles, reading the session as it is then.
      entry.flushing = entry.flushing.then(() => write(sessionId, entry))
    }
    await entry.flushing
  }

  /**
   * Opens a session. One for a new entry writes nothing yet: a composer someone opened and walked
   * away from is not a draft, and a drafts list full of empty rows would defeat the point of having one.
   * A session that could revise an entry is written at once instead, as a claim every tab can see
   * before a word is typed, so another tab resumes it rather than beginning a second draft on the
   * same version. `abandonDraft` releases it if nothing comes of it.
   */
  function beginDraft(start: BeginDraftInput): string {
    const sessionId = newId()
    const snapshot = startingSnapshot(start, sessionId, newTimestamp())
    const entry = open(withEvents(snapshot, { entry: [], parent: [] }))

    active.set(sessionId, entry)
    if (claimsEntry(snapshot)) {
      entry.dirty = true
      void flush(sessionId)
    }
    return sessionId
  }

  /** The in-progress snapshot, without waiting for it to reach disk. */
  function currentDraft(sessionId: string): DraftSnapshot | null {
    const entry = active.get(sessionId)
    return entry ? structuredClone(entry.draft) : null
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
   * Reopens a draft with its event logs intact, always as disk has it: another tab may have
   * carried it on since this one last held it. Anything this tab still holds is written first, so
   * the read includes it; if that write fails, what this tab holds is all there is.
   */
  async function resumeDraft(sessionId: string): Promise<DraftSnapshot | null> {
    // What another tab did before now is in what this reads. Only a change from here on is news,
    // including the write below losing to one.
    const { [sessionId]: _seen, ...unseen } = changedElsewhere.value
    changedElsewhere.value = unseen

    await letGo(sessionId)
    if (!active.has(sessionId)) {
      const draft = await draftRepository.getById(sessionId)
      if (!draft) return null

      active.set(sessionId, open(draft)) // Nothing new to write until this session is typed in.
    }
    return currentDraft(sessionId)
  }

  function requireActive(sessionId: string): ActiveSession {
    const entry = active.get(sessionId)
    if (!entry) {
      throw new Error(`No open draft session ${sessionId}`)
    }
    return entry
  }

  /** Marks a session as holding something unwritten, and schedules the flush that writes it. */
  function markDirty(sessionId: string, entry: ActiveSession): void {
    entry.dirty = true
    if (entry.timer !== null) return

    // A throttle, not a debounce: later keystrokes don't restart the timer, so continuous typing
    // still writes every DRAFT_FLUSH_MS rather than waiting for a pause that may never come.
    entry.timer = setTimeout(() => {
      entry.timer = null
      void flush(sessionId)
    }, DRAFT_FLUSH_MS)
  }

  /** Swaps in a session's next snapshot, stamped now, and schedules the flush that writes it. */
  function replaceSnapshot(sessionId: string, entry: ActiveSession, next: DraftSnapshot): void {
    entry.draft = { ...next, updated_at: newTimestamp() }
    markDirty(sessionId, entry)
  }

  /**
   * Records a change and schedules a flush. The buffer is append-only while the session runs:
   * events accumulate and nothing already recorded is rewritten, so no authoring history is lost by
   * design. Only the snapshot moves.
   */
  function recordChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)
    entry.recorder.record(change)

    const { draft } = entry
    replaceSnapshot(sessionId, entry, {
      ...draft,
      entry: { ...draft.entry, content: change.content, title: change.title },
    })
  }

  /**
   * Records a change to the **parent's** provisional document, for an anchor-mode session only —
   * an ordinary `DraftChange` like the entry's own, against the session's second document. Which
   * anchors the session has placed is nowhere in here: it is the difference between the parent's
   * base version and `parent.content` (`anchorsPlacedSince`), read when someone asks.
   */
  function recordParentChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)
    const { draft, parentRecorder } = entry
    if (draft.kind !== 'new_related' || !parentRecorder) {
      throw new Error('recordParentChange called on a session with no parent document')
    }

    parentRecorder.record(change)

    replaceSnapshot(sessionId, entry, {
      ...draft,
      parent: { ...draft.parent, content: change.content },
    })
  }

  /**
   * Records the details set alongside the words. Copied into plain objects rather than stored by
   * reference: these arrive from a form's reactive state, and a Vue proxy does not survive the
   * `structuredClone` on the way into the repository.
   */
  function recordDetails(sessionId: string, details: EntryDetails): void {
    const entry = requireActive(sessionId)
    const { draft } = entry

    replaceSnapshot(sessionId, entry, {
      ...draft,
      entry: { ...draft.entry, ...entryDetailsOf(details) },
    })
  }

  /** A mark the writer asked for, rather than one a policy finds. */
  function addMark(sessionId: string): void {
    const entry = requireActive(sessionId)

    entry.recorder.mark()
    markDirty(sessionId, entry)
  }

  /** Writes everything pending now, for a tab being left: whatever opens a draft next reads disk. */
  async function flushAll(): Promise<void> {
    await Promise.all([...active.keys()].map((sessionId) => flush(sessionId)))
  }

  async function catchUpWithDisk(): Promise<void> {
    // A write of this tab's still landing would read as someone else's, and one that deletes a row
    // takes its session off disk, so which sessions are asked about is settled after them.
    await writesLanded()
    const written = [...active.entries()].filter(([, entry]) => entry.draft.write_id !== null)

    try {
      drafts.value = await draftRepository.list()
      const stored = new Map(drafts.value.map((row) => [row.session_id, row.write_id]))
      for (const [sessionId, entry] of written) {
        if (stored.get(sessionId) === entry.draft.write_id) continue
        await adoptStored(sessionId, entry.dirty ? entry.draft : null)
      }
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to check drafts')
    }
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

  /**
   * The explicit user action that ends a session: the immutable entries holding the final snapshot
   * and the completed traces, written in the same transaction that removes the draft. Never an idle
   * timeout — until someone seals, the work stays a draft, recoverable and absent from every
   * timeline. A refused seal keeps the session open and its draft on disk; refused for another
   * tab's write, the session catches up with it instead (`adoptStored`).
   */
  async function sealDraft(sessionId: string): Promise<Entry> {
    const entry = requireActive(sessionId)
    cancelFlush(entry)
    await entry.flushing

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
      written = await draftRepository.seal(sessionId, inputs, entry.draft.write_id)
    } catch (err) {
      // Always with this tab's snapshot, typed since or not: the writer asked for a save that
      // didn't happen. Adopting may close the session, so nothing here is left to flush.
      if (err instanceof DraftConflictError) {
        await adoptStored(sessionId, entry.draft)
        throw err
      }

      error.value = toErrorMessage(err, 'Failed to save entry')
      if (entry.dirty) markDirty(sessionId, entry) // Unflushed typing still has to reach disk.
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
   * Removes a claim that holds no work. Judged by what disk holds rather than this tab's copy:
   * another tab may have resumed the draft and written in it since, even after the read here, which
   * refuses the delete and keeps the claim.
   */
  async function releaseIfEmpty(sessionId: string): Promise<void> {
    try {
      const stored = await draftRepository.getById(sessionId)
      if (!stored || (await useEntriesStore().draftHoldsWork(stored))) return

      await draftRepository.delete(sessionId, stored.write_id)
      await loadDrafts()
    } catch (err) {
      if (err instanceof DraftConflictError) return
      error.value = toErrorMessage(err, 'Failed to release draft')
    }
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

  /**
   * Throws the session away. The one thing that ever removes work, and only on request. A draft no
   * session here holds is discarded as `seen`, the stored write its caller last read: a list row,
   * or a draft that couldn't be reopened. Refused for another tab's write, an open session catches
   * up with it, as a refused seal does; with none open, the list is reread to show it.
   */
  async function discardDraft(sessionId: string, seen: string | null): Promise<void> {
    const entry = active.get(sessionId)
    if (entry) {
      cancelFlush(entry)
      await entry.flushing
    }

    try {
      await draftRepository.delete(sessionId, entry ? entry.draft.write_id : seen)
    } catch (err) {
      if (err instanceof DraftConflictError) {
        if (entry) await adoptStored(sessionId, entry.draft)
        else await loadDrafts()
      }
      throw err
    }
    active.delete(sessionId) // Only once the row is gone: a failed delete leaves the session open.
    await loadDrafts()
  }

  return {
    drafts,
    error,
    changedElsewhere,
    loadDrafts,
    flush,
    beginDraft,
    currentDraft,
    resumeDraft,
    recordChange,
    recordParentChange,
    recordDetails,
    addMark,
    flushAll,
    adoptChangesElsewhere,
    sealDraft,
    abandonDraft,
    discardDraft,
  }
})
