import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { AuthoringSession } from '@/domain/authoringSession'
import { isEmptyDocument } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import type { Draft, DraftTarget } from '@/types/draft'
import {
  newEntryId,
  newEntryTimestamp,
  type AnchorOp,
  type Entry,
  type TickReason,
} from '@/types/entry'
import { useEntriesStore } from './entriesStore'

/**
 * How long typing may go unpersisted. Short enough that a crash costs a fraction of a sentence,
 * long enough that a fast typist is not writing to disk on every keystroke.
 *
 * This is autosave and it is unrelated to tick marking: flushing is about never losing work, and
 * marks nothing; a tick is a bookmark and writes nothing.
 */
export const DRAFT_FLUSH_MS = 300

/** What one editor change tells the buffer. */
export interface DraftChange {
  /** The document as it now stands. */
  content: string
  /** Serialized ProseMirror steps for this change. The session never interprets them. */
  steps?: unknown[]
  /** Text the change added, used only to spot a finished sentence. */
  insertedText?: string
  isFormatting?: boolean
  /** Anchored ops being composed, for a child draft. */
  anchors?: AnchorOp[]
}

interface ActiveSession {
  draft: Draft
  session: AuthoringSession
  timer: ReturnType<typeof setTimeout> | null
  /** True once anything has actually been typed, so an opened-and-abandoned composer saves nothing. */
  dirty: boolean
  /** Whether a row for this session exists on disk, so an emptied draft knows to remove it. */
  persisted: boolean
}

export const useDraftsStore = defineStore('drafts', () => {
  const drafts = shallowRef<Draft[]>([])
  const error = ref<string | null>(null)

  // Not reactive: this holds timers and an authoring session, none of which a template reads, and
  // a Vue proxy over the draft would not survive structuredClone on its way into the repository.
  const active = new Map<string, ActiveSession>()

  /**
   * Opens a session. Nothing is written yet: a composer someone opened and walked away from is not
   * a draft, and a drafts list full of empty rows would defeat the point of having one.
   */
  function beginDraft(target: DraftTarget, seed: { content?: string; anchors?: AnchorOp[] } = {}) {
    const sessionId = newEntryId()
    const startedAt = newEntryTimestamp()

    active.set(sessionId, {
      draft: {
        session_id: sessionId,
        target,
        started_at: startedAt,
        updated_at: startedAt,
        content: seed.content ?? '',
        anchors: seed.anchors ?? [],
        steps: [],
        ticks: [],
      },
      session: new AuthoringSession({ sessionId, startedAt }),
      timer: null,
      dirty: false,
      persisted: false,
    })

    return sessionId
  }

  /** Reopens a draft left behind by a reload, with its step chain and bookmarks intact. */
  async function resumeDraft(sessionId: string): Promise<Draft | null> {
    const existing = active.get(sessionId)
    if (existing) return structuredClone(existing.draft)

    const draft = await draftRepository.getById(sessionId)
    if (!draft) return null

    active.set(sessionId, {
      draft,
      session: AuthoringSession.resume({
        sessionId,
        startedAt: draft.started_at,
        steps: draft.steps,
        ticks: draft.ticks,
      }),
      timer: null,
      // Nothing new to write until this session is typed in, but the row is already on disk, so
      // emptying it later has something to delete.
      dirty: false,
      persisted: true,
    })

    return structuredClone(draft)
  }

  /**
   * Records a change and schedules a flush. The buffer is append-only while the session runs: steps
   * accumulate and nothing already recorded is rewritten, so no authoring history is lost by
   * design. Only the snapshot moves.
   */
  function recordChange(sessionId: string, change: DraftChange): void {
    const entry = requireActive(sessionId)

    entry.session.record({
      steps: change.steps ?? [],
      insertedText: change.insertedText,
      isFormatting: change.isFormatting,
    })

    entry.draft = {
      ...entry.draft,
      content: change.content,
      anchors: change.anchors ?? entry.draft.anchors,
      updated_at: newEntryTimestamp(),
      steps: entry.session.steps,
      ticks: entry.session.ticks,
    }
    entry.dirty = true

    scheduleFlush(sessionId)
  }

  /** A bookmark the writer asked for, rather than one the policy noticed. */
  function markTick(sessionId: string, reason: TickReason = 'manual'): void {
    const entry = requireActive(sessionId)

    entry.session.mark(reason)
    entry.draft = { ...entry.draft, ticks: entry.session.ticks }
    scheduleFlush(sessionId)
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

    if (isEmptyDocument(entry.draft.content)) {
      if (entry.persisted) {
        await draftRepository.delete(sessionId)
        entry.persisted = false
      }
      return
    }

    await draftRepository.save(entry.draft)
    entry.persisted = true
  }

  /**
   * The explicit user action that ends a session: one immutable entry holding the final snapshot
   * and the completed trace, then the buffer is discarded. Never an idle timeout — until someone
   * seals, the work stays a draft, recoverable and absent from every timeline.
   */
  async function sealDraft(sessionId: string): Promise<Entry> {
    const entry = requireActive(sessionId)
    cancelFlush(entry)

    if (isEmptyDocument(entry.draft.content)) {
      throw new Error('Entry content cannot be empty')
    }

    error.value = null

    try {
      const created = await useEntriesStore().createFromDraft(entry.draft, entry.session.seal())

      // Only now: the draft's contents already live in a committed entry, so deleting the buffer
      // loses nothing. Sealing before the write succeeded would lose everything.
      active.delete(sessionId)
      await draftRepository.delete(sessionId)
      await loadDrafts()

      return created
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save entry'
      throw err
    }
  }

  /** Throws the session away. The one thing that ever removes work, and only on request. */
  async function discardDraft(sessionId: string): Promise<void> {
    const entry = active.get(sessionId)
    if (entry) cancelFlush(entry)

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
      error.value = err instanceof Error ? err.message : 'Failed to load drafts'
      throw err
    }
  }

  /** The in-progress snapshot, without waiting for it to reach disk. */
  function currentDraft(sessionId: string): Draft | null {
    const entry = active.get(sessionId)
    return entry ? structuredClone(entry.draft) : null
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
    markTick,
    flush,
    sealDraft,
    discardDraft,
    loadDrafts,
    currentDraft,
  }
})
