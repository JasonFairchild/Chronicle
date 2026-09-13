import { computed, reactive, ref } from 'vue'
import type { EditorChange } from '@/components/DocumentEditor.vue'
import { isEmptyDocument } from '@/domain/entryDocument'
import { useDraftsStore } from '@/stores/draftsStore'
import type { Draft, DraftTarget } from '@/types/draft'
import { emptyEntryDates, type Entry, type EntryDates } from '@/types/entry'

/**
 * One single-document draft session — begin or resume it, mirror an editor's changes into it, seal
 * or discard it — factored out because `EntryDetailView` (its revision session, and the prose half
 * of its anchor-mode session) and `DraftsView` (resuming any draft from the list) were each
 * hand-rolling the same shape: mirror a session's content into a local ref, track a saving flag,
 * forward `DocumentEditor`'s `@change`, wrap save/discard in the same try/catch.
 *
 * Deliberately does not manage an error ref of its own: `save()` and `discard()` propagate a real
 * failure to the caller, which already has somewhere to put a message (`actionError`, a page-level
 * `error`), and folding a second error slot in here would just be another thing for two to drift.
 */
export function useDraftSession() {
  const drafts = useDraftsStore()

  const sessionId = ref<string | null>(null)
  const content = ref('')
  const dates = ref<EntryDates>(emptyEntryDates())
  const saving = ref(false)
  /**
   * The parent document as an anchor-mode session has provisionally marked it — the second document
   * such a session edits (`Draft.parent_content`), empty for every other target.
   *
   * It lives here rather than beside the session in whichever view opened it because resuming is
   * what makes the difference: a view that tracked it separately would restore the child's prose
   * from the draft and silently leave the parent half behind.
   */
  const parentContent = ref('')

  const isOpen = computed(() => sessionId.value !== null)

  /** The same condition `entriesStore.requireContent` enforces, asked before the button is offered. */
  const canSave = computed(() => !isEmptyDocument(content.value))

  /** Opens a brand-new session — nothing is written until the first real change. */
  function begin(target: DraftTarget, seed: { content?: string; parentContent?: string } = {}) {
    content.value = seed.content ?? ''
    parentContent.value = seed.parentContent ?? ''
    dates.value = emptyEntryDates()
    sessionId.value = drafts.beginDraft(target, seed)
  }

  /** Reopens a draft left behind by a reload, with its step chain intact. Null if it no longer exists. */
  async function resume(existingSessionId: string): Promise<Draft | null> {
    const resumed = await drafts.resumeDraft(existingSessionId)
    if (!resumed) return null

    content.value = resumed.content
    parentContent.value = resumed.parent_content ?? ''
    dates.value = resumed.dates ?? emptyEntryDates()
    sessionId.value = existingSessionId
    return resumed
  }

  /** Forwards one `DocumentEditor` change into the session. */
  function handleChange(change: EditorChange): void {
    if (!sessionId.value) return

    content.value = change.content
    drafts.recordChange(sessionId.value, change)
  }

  /**
   * Forwards one change to the **parent's** provisional document, anchor-mode only. `anchorIds` is
   * the full set placed so far rather than a delta — see `draftsStore.recordParentChange`.
   */
  function handleParentChange(change: EditorChange): void {
    if (!sessionId.value) return

    parentContent.value = change.content
    drafts.recordParentChange(sessionId.value, {
      content: change.content,
      steps: change.steps,
      anchorIds: change.anchorIds ?? [],
    })
  }

  /** Mirrors the dates a form holds into the session, so a reload keeps them too. */
  function handleDatesChange(next: EntryDates): void {
    dates.value = next
    if (sessionId.value) drafts.recordDates(sessionId.value, next)
  }

  /**
   * Seals the session. Resolves to `null` — rather than running at all — when there is nothing
   * open or a save is already in flight, so a caller can guard a button's click handler with
   * `if (!(await session.save())) return` the same way it would have guarded on a local flag. A
   * real sealing failure (empty content, "no changes to save") still throws, for the caller's own
   * try/catch and error message to handle.
   */
  async function save(): Promise<Entry | null> {
    const id = sessionId.value
    if (!id || saving.value) return null

    saving.value = true
    try {
      const entry = await drafts.sealDraft(id)
      sessionId.value = null
      return entry
    } finally {
      saving.value = false
    }
  }

  /**
   * Closes the session because whatever opened it is going away, keeping whatever already reached
   * disk — `draftsStore.abandonDraft` flushes what is pending and only drops a session nothing was
   * ever typed into. The counterpart to `discard`, which is someone asking for the work to go.
   */
  async function abandon(): Promise<void> {
    const id = sessionId.value
    if (!id) return

    sessionId.value = null
    await drafts.abandonDraft(id)
  }

  /** Throws the session away on request — an explicit "Discard" click. */
  async function discard(): Promise<void> {
    const id = sessionId.value
    if (!id) return

    sessionId.value = null
    await drafts.discardDraft(id)
  }

  /**
   * Ends the session without a user action to await — navigating away, switching to another entry,
   * closing the view — and clears the local state behind it, for a view that stays mounted around
   * a new one. Fire and forget, matching a session's own rule that a draft already on disk survives
   * being abandoned.
   *
   * `abandon`, never `discard`: leaving a screen is not asking for the work to go. The reason the
   * session has to close at all is that a save afterwards would seal against whichever entry the
   * draft still points at, and that is a reason to stop holding it, not a reason to delete it. The
   * drafts list is where it is picked up again.
   */
  function reset(): void {
    void abandon()
    content.value = ''
    parentContent.value = ''
    dates.value = emptyEntryDates()
    saving.value = false
  }

  return reactive({
    sessionId,
    content,
    parentContent,
    dates,
    saving,
    isOpen,
    canSave,
    begin,
    resume,
    handleChange,
    handleParentChange,
    handleDatesChange,
    save,
    abandon,
    discard,
    reset,
  })
}

export type DraftSession = ReturnType<typeof useDraftSession>
