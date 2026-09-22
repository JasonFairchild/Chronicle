import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { anchorsPlacedSince } from '@/domain/anchors'
import { AuthoringSession } from '@/domain/authoringSession'
import { isEmptyEntry } from '@/domain/entryDocument'
import type { ChangeSignals } from '@/domain/tickPolicy'
import { draftRepository } from '@/repositories'
import type { PersistedSteps } from '@/repositories/draftRepository'
import type { Draft, DraftSummary, DraftTarget } from '@/types/draft'
import {
  emptyEntryDates,
  newEntryId,
  newEntryTimestamp,
  type Entry,
  type EntryDates,
  type TickReason,
} from '@/types/entry'
import { toErrorMessage } from '@/utils/format'
import { useEntriesStore } from './entriesStore'

/**
 * How long typing may go unpersisted. Short enough that a crash costs a fraction of a sentence,
 * long enough that a fast typist is not writing to disk on every keystroke.
 *
 * This is autosave and it is unrelated to tick marking: flushing is about never losing work, and
 * marks nothing; a tick is a bookmark and writes nothing.
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
  /** Characters this change removed, for the `deletion` run the session tracks across changes. */
  removedChars?: number
}

interface ActiveSession {
  draft: Draft
  session: AuthoringSession
  /** The parent's own step chain for an anchor-mode session. Unused by every other target. */
  parentSession: AuthoringSession
  timer: ReturnType<typeof setTimeout> | null
  /** True once anything has actually been typed, so an opened-and-abandoned composer saves nothing. */
  dirty: boolean
  /** Whether a row for this session exists on disk, so an emptied draft knows to remove it. */
  persisted: boolean
  /**
   * How much of each step chain the store already holds, so the next flush's `save` appends only
   * the tail. Advanced only after a successful write — see `flush` — and reset to zero the moment
   * a write deletes the row instead, or the counts and what's actually stored would drift apart.
   */
  persistedSteps: PersistedSteps
  /**
   * The repository write `flush` is currently awaiting, if any. Cancelling the timer stops a
   * flush that hasn't started; it does nothing for one already mid-write. Sealing or discarding
   * must wait on this too, or a write that resolves after `delete()` has already run would
   * resurrect the row it just removed.
   */
  flushing: Promise<void> | null
}

export const useDraftsStore = defineStore('drafts', () => {
  const drafts = shallowRef<DraftSummary[]>([])
  const error = ref<string | null>(null)

  // Not reactive: this holds timers and an authoring session, none of which a template reads, and
  // a Vue proxy over the draft would not survive structuredClone on its way into the repository.
  const active = new Map<string, ActiveSession>()

  /**
   * Opens a session. Nothing is written yet: a composer someone opened and walked away from is not
   * a draft, and a drafts list full of empty rows would defeat the point of having one.
   */
  function beginDraft(
    target: DraftTarget,
    seed: {
      content?: string
      title?: string | null
      parentContent?: string
      parentTitle?: string | null
    } = {},
  ) {
    const sessionId = newEntryId()
    const startedAt = newEntryTimestamp()

    active.set(sessionId, {
      draft: {
        session_id: sessionId,
        target,
        started_at: startedAt,
        updated_at: startedAt,
        dates: emptyEntryDates(),
        title: seed.title ?? null,
        child: { content: seed.content ?? '', steps: [], ticks: [] },
        // `base_content` starts equal to `content`: nothing has been marked yet, so this is also
        // what "which anchors are this session's" (`anchorsPlacedSince`) diffs against. The
        // parent's title is captured the same way, once, since anchor mode never offers it again.
        parent:
          seed.parentContent !== undefined
            ? {
                content: seed.parentContent,
                title: seed.parentTitle ?? null,
                base_content: seed.parentContent,
                steps: [],
                ticks: [],
              }
            : null,
      },
      session: new AuthoringSession(sessionId, startedAt),
      parentSession: new AuthoringSession(sessionId, startedAt),
      timer: null,
      dirty: false,
      persisted: false,
      persistedSteps: { child: 0, parent: 0 },
      flushing: null,
    })

    return sessionId
  }

  /** Reopens a draft left behind by a reload, with its step chain and bookmarks intact. */
  async function resumeDraft(sessionId: string): Promise<Draft | null> {
    const existing = active.get(sessionId)
    if (existing) return structuredClone(materialize(existing))

    const draft = await draftRepository.getById(sessionId)
    if (!draft) return null

    active.set(sessionId, {
      draft,
      session: AuthoringSession.resume(sessionId, draft.started_at, {
        steps: draft.child.steps,
        ticks: draft.child.ticks,
      }),
      // Its own step chain, so the parent revision gets an honest authoring trace too — the same
      // `AuthoringSession` class and the same tick policy as `session` above, just a second
      // instance for a second document (see `recordInto`).
      parentSession: AuthoringSession.resume(sessionId, draft.started_at, {
        steps: draft.parent?.steps ?? [],
        ticks: draft.parent?.ticks ?? [],
      }),
      timer: null,
      // Nothing new to write until this session is typed in, but the row is already on disk, so
      // emptying it later has something to delete.
      dirty: false,
      persisted: true,
      // What was loaded is, by definition, already stored.
      persistedSteps: { child: draft.child.steps.length, parent: draft.parent?.steps.length ?? 0 },
      flushing: null,
    })

    return structuredClone(draft)
  }

  /**
   * Appends a change into an `AuthoringSession` — shared by `recordChange` (the entry's own prose)
   * and `recordParentChange` (the parent's provisional document in an anchor-mode session), so both
   * streams are recorded exactly the same way. Anchor mode limits what the *editor* can produce
   * (ENTRY_MODEL.md, "Two creation experiences, kept separate"); this is the session that records
   * whatever it does produce, and it has no notion of which mode a change came from.
   *
   * A change with no steps did not touch the traced document — a retitling is the one that does
   * this for `recordChange`, since the title is a plain field beside the editor rather than part of
   * it. There is nothing for the trace to append and no typing for the tick policy to judge, so it
   * is skipped entirely; counting it would bookmark a stream for something that never entered it.
   */
  function recordInto(session: AuthoringSession, change: DraftChange): void {
    if ((change.steps ?? []).length === 0) return

    session.record({ ...change, steps: change.steps ?? [] })
  }

  /**
   * Records a change and schedules a flush. The buffer is append-only while the session runs: steps
   * accumulate and nothing already recorded is rewritten, so no authoring history is lost by
   * design. Only the snapshot moves.
   */
  function recordChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)
    recordInto(entry.session, change)

    entry.draft = {
      ...entry.draft,
      updated_at: newEntryTimestamp(),
      title: change.title ?? null,
      child: { ...entry.draft.child, content: change.content },
    }
    entry.dirty = true

    scheduleFlush(sessionId)
  }

  /**
   * Records a change to the **parent's** provisional document, for an anchor-mode session only —
   * an ordinary `DraftChange` like the child's own, against the session's second document. Which
   * anchors the session has placed is nowhere in here: it is the difference between
   * `parent.base_content` and `parent.content` (`anchorsPlacedSince`), read when someone asks.
   */
  function recordParentChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)
    const parent = entry.draft.parent
    if (!parent) {
      throw new Error('recordParentChange called on a session with no parent document')
    }

    recordInto(entry.parentSession, change)

    entry.draft = {
      ...entry.draft,
      updated_at: newEntryTimestamp(),
      parent: { ...parent, content: change.content },
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

    entry.draft = { ...entry.draft, dates: { ...dates }, updated_at: newEntryTimestamp() }
    entry.dirty = true

    scheduleFlush(sessionId)
  }

  /** A bookmark the writer asked for, rather than one the policy noticed. */
  function markTick(sessionId: string, reason: TickReason = 'manual'): void {
    const entry = requireActive(sessionId)

    entry.session.mark([reason])
    entry.dirty = true
    scheduleFlush(sessionId)
  }

  /**
   * Builds the draft's on-disk shape from the session's live step/tick chains — the one place those
   * chains are read, right before something needs the whole draft. Keeping it out of the per-change
   * paths matters because `AuthoringSession.steps` hands back a defensive copy, so reading it on
   * every keystroke would clone the entire chain each time.
   *
   * Always fresh objects, never `entry.draft.child`/`.parent` by reference, so a snapshot already
   * handed to an in-flight `save()` can't be mutated out from under it.
   */
  function materialize(entry: ActiveSession): Draft {
    return {
      ...entry.draft,
      child: {
        content: entry.draft.child.content,
        steps: entry.session.steps,
        ticks: entry.session.ticks,
      },
      parent: entry.draft.parent
        ? {
            ...entry.draft.parent,
            steps: entry.parentSession.steps,
            ticks: entry.parentSession.ticks,
          }
        : null,
    }
  }

  /**
   * Writes the pending snapshot now, cancelling any scheduled flush.
   *
   * An empty document never reaches disk. A draft is a piece of writing in progress, and a row
   * holding no writing is noise in the drafts list at best and a false promise of recoverable work
   * at worst. Emptying a draft that had words *deletes* its row rather than skipping the write,
   * because leaving the last non-empty snapshot behind would show a draft that no longer matches
   * anything the writer can see.
   */
  async function flush(sessionId: string): Promise<void> {
    const entry = active.get(sessionId)
    if (!entry) return

    cancelFlush(entry)
    if (!entry.dirty) return
    entry.dirty = false

    const write = (async () => {
      const draft = materialize(entry)

      // A blank child note is not yet a draft worth keeping, unless anchors have already been
      // placed on the parent — that is real, crash-worthy work even before a word of prose exists.
      const placedAnchors = anchorsPlacedSince(
        draft.parent?.base_content ?? null,
        draft.parent?.content ?? null,
      )
      if (isEmptyEntry(draft.child.content, draft.title) && placedAnchors.length === 0) {
        if (entry.persisted) {
          await draftRepository.delete(sessionId)
          entry.persisted = false
          // The row and its steps are both gone; the next save must start the chain over.
          entry.persistedSteps = { child: 0, parent: 0 }
        }
        return
      }

      await draftRepository.save(draft, entry.persistedSteps)
      entry.persisted = true
      entry.persistedSteps = {
        child: draft.child.steps.length,
        parent: draft.parent?.steps.length ?? 0,
      }
    })()

    entry.flushing = write
    try {
      await write
    } catch (err) {
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
   * The explicit user action that ends a session: one immutable entry holding the final snapshot
   * and the completed trace, then the buffer is discarded. Never an idle timeout — until someone
   * seals, the work stays a draft, recoverable and absent from every timeline.
   */
  async function sealDraft(sessionId: string): Promise<Entry> {
    const entry = requireActive(sessionId)
    cancelFlush(entry)
    // A flush already mid-write must finish before anything below deletes this session's row, or
    // its resolution could land after the delete and resurrect a draft for content that has
    // already become a real entry.
    await entry.flushing?.catch(() => {})

    if (isEmptyEntry(entry.draft.child.content, entry.draft.title)) {
      throw new Error('Entry content cannot be empty')
    }

    error.value = null

    try {
      const created = await useEntriesStore().createFromDraft(
        entry.draft,
        entry.session.seal(),
        entry.parentSession.seal(),
      )

      // Only now: the draft's contents already live in a committed entry, so deleting the buffer
      // loses nothing. Sealing before the write succeeded would lose everything.
      active.delete(sessionId)
      await draftRepository.delete(sessionId)
      await loadDrafts()

      return created
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to save entry')
      throw err
    }
  }

  /**
   * Called when whatever opened a session goes away — a composer unmounted, a page navigated from
   * — without the user explicitly saving or discarding. Real, already-persisted work is left
   * exactly as `flush` leaves it: a resumable draft, since closing a tab must not discard it. A
   * session nothing was ever typed into has nothing worth keeping, so it is dropped from memory
   * rather than left in `active` forever with no way for the UI to ever reach it again.
   */
  async function abandonDraft(sessionId: string): Promise<void> {
    await flush(sessionId)

    const entry = active.get(sessionId)
    if (entry && !entry.persisted) {
      active.delete(sessionId)
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

    // Trailing edge only: a burst of keystrokes writes once, at the end of the burst.
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
    beginDraft,
    resumeDraft,
    recordChange,
    recordParentChange,
    recordDates,
    markTick,
    flush,
    abandonDraft,
    sealDraft,
    discardDraft,
    loadDrafts,
    currentDraft,
  }
})
