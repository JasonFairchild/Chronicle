import { computed, reactive, ref } from 'vue'
import type { EditorChange } from '@/components/DocumentEditor.vue'
import { useDraftsStore } from '@/stores/draftsStore'
import type { Draft, DraftTarget } from '@/types/draft'
import type { Entry } from '@/types/entry'

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
  const saving = ref(false)

  const isOpen = computed(() => sessionId.value !== null)

  /** Opens a brand-new session — nothing is written until the first real change. */
  function begin(target: DraftTarget, seed: { content?: string; parentContent?: string } = {}) {
    content.value = seed.content ?? ''
    sessionId.value = drafts.beginDraft(target, seed)
  }

  /** Reopens a draft left behind by a reload, with its step chain intact. Null if it no longer exists. */
  async function resume(existingSessionId: string): Promise<Draft | null> {
    const resumed = await drafts.resumeDraft(existingSessionId)
    if (!resumed) return null

    content.value = resumed.content
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

  /** Throws the session away on request — an explicit "Discard" click. */
  async function discard(): Promise<void> {
    const id = sessionId.value
    if (!id) return

    sessionId.value = null
    await drafts.discardDraft(id)
  }

  /**
   * Ends the session without a user action to await — navigating away, closing the view. Fire and
   * forget, matching a session's own rule that a draft already on disk survives being abandoned.
   */
  function reset(): void {
    if (sessionId.value) void drafts.discardDraft(sessionId.value)
    sessionId.value = null
    content.value = ''
    saving.value = false
  }

  return reactive({
    sessionId,
    content,
    saving,
    isOpen,
    begin,
    resume,
    handleChange,
    save,
    discard,
    reset,
  })
}

export type DraftSession = ReturnType<typeof useDraftSession>
