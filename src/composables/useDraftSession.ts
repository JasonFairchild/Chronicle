import { computed, reactive, ref, shallowRef, watch } from 'vue'

import type { EditorChange } from '@/components/DocumentEditor.vue'
import { docToPlainText, isBlankDraft, isEmptyDocument } from '@/domain/entryDocument'
import { StaleVersionError } from '@/domain/entryValidation'
import { currentVersionId } from '@/domain/reconstructEntryState'
import { DraftConflictError } from '@/repositories/draftRepository'
import { type BeginDraftInput, DraftUnreadableError, useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import { type DraftSnapshot, versionsRevisedBy } from '@/types/draft'
import { emptyEntryDetails, type Entry, type EntryDetails, entryDetailsOf } from '@/types/entry'

/**
 * One single-document draft session: begin or resume it, mirror an editor's changes into it, seal
 * or discard it. Every composer needs the same shape — content mirrored into a local ref, a saving
 * flag, `DocumentEditor`'s `@change` forwarded, save and discard wrapped the same way — and holding
 * it once is what keeps a resumed session identical to a fresh one.
 *
 * Deliberately manages no error ref of its own: `save()` and `discard()` propagate a real failure
 * to the caller, which already has somewhere to put a message (`actionError`, a page-level
 * `error`), and a second error slot here would just be another thing for the two to drift apart on.
 */
export function useDraftSession() {
  const drafts = useDraftsStore()
  const entries = useEntriesStore()

  const sessionId = ref<string | null>(null)
  const content = ref('')
  const title = ref<string | null>(null)
  const details = ref<EntryDetails>(emptyEntryDetails())
  const saving = ref(false)
  /**
   * The parent document as an anchor-mode session has provisionally marked it — `Draft.parent`,
   * empty for every other target.
   *
   * It lives here rather than beside the session in whichever view opened it because resuming is
   * what makes the difference: a view that tracked it separately would restore the related entry's
   * prose from the draft and silently leave the parent half behind.
   */
  const parentContent = ref('')
  /**
   * The parent's own title, for display beside its document. Not stored in the draft: anchor mode
   * never changes it, so it is read off the entry. Never editable from here.
   */
  const parentTitle = ref<string | null>(null)
  /**
   * The document of the version `Draft.parent.base_version_id` names, never reassigned while the
   * session runs. Seeds `DocumentEditor`'s `anchor-base-content` on a resume, so an anchor placed
   * before a reload still reads as this session's own rather than as an earlier related entry's.
   */
  const parentBaseContent = ref('')
  // What the open draft is, and whether the entry it could revise has moved past the version it
  // started from. A claim keeps that from happening (PRODUCT.md §4.8) all but in a race, so it is
  // learned when the draft is reopened, or when a save is refused for it.
  const kind = ref<DraftSnapshot['kind'] | null>(null)
  const stale = ref(false)

  const isOpen = computed(() => sessionId.value !== null)
  /**
   * Set while the open draft is one `resume` couldn't carry on, shown read-only. The store holds no
   * session for it, so `discard` names the stored write itself.
   */
  const unreadable = shallowRef<DraftUnreadableError | null>(null)

  /**
   * Why a stale related entry's marks can't be saved. The entry itself still can, once they're
   * removed, so unlike a stale revision it stays open for editing (`readOnlyReason`).
   */
  const staleNotice = computed(() =>
    stale.value && kind.value === 'new_related' && !unreadable.value
      ? 'This entry was revised after this draft began, so passages marked here can’t be saved. ' +
        'The related entry itself still can, with nothing marked.'
      : null,
  )

  /** The same condition `entriesStore.requireContent` enforces, asked before a save. */
  const canSave = computed(() => !isEmptyDocument(content.value))

  /** Said when another tab changed this draft in a way the writer should know about. */
  const elsewhereNotice = ref<string | null>(null)
  /** What this tab held when another tab's version replaced it, for the writer to copy from. */
  const unsaved = ref<{ title: string | null; text: string } | null>(null)
  /**
   * Why the draft is shown only to copy from, with nothing that could change it; null while it can
   * be written. Its words are all there either way, but a change would have nowhere to go: one that
   * can't be reopened has no trace to carry on, and a stale revision could never be saved.
   */
  const readOnlyReason = computed(() => {
    if (!isOpen.value) return null // Hosts mount on `isOpen`; `abandon` leaves `unreadable` set.
    if (unreadable.value) return unreadable.value.message
    if (stale.value && kind.value === 'revision') {
      return (
        'This entry was revised after this draft began, so saving this would overwrite ' +
        'that version.'
      )
    }
    return null
  })
  const readOnly = computed(() => readOnlyReason.value !== null)

  const reloads = ref(0)
  /**
   * What an editor showing this session is keyed on. It changes when the draft is reloaded from
   * disk under it, or turns read-only: `DocumentEditor` reads its content and whether it can be
   * typed in once, on mount, so a remount is the swap.
   */
  const editorKey = computed(
    () => `${sessionId.value ?? ''}:${reloads.value}:${readOnly.value ? 'read' : 'write'}`,
  )

  /**
   * Mirrors what a draft stores into the refs an editor binds to, whether it is beginning or
   * resuming. The parent's title and base are read off entries, so whoever opens it sets those.
   */
  function mirror(draft: DraftSnapshot): void {
    kind.value = draft.kind
    content.value = draft.entry.content
    title.value = draft.entry.title
    details.value = entryDetailsOf(draft.entry)
    parentContent.value = draft.kind === 'new_related' ? draft.parent.content : ''
  }

  /** Takes a draft as this session's from here on, with the last one's notices cleared. */
  function openAs(id: string): void {
    elsewhereNotice.value = null
    unsaved.value = null
    unreadable.value = null
    sessionId.value = id
  }

  /** Opens a brand-new session — nothing is written until the first real change. */
  function begin(start: BeginDraftInput): void {
    const id = drafts.beginDraft(start)

    mirror(drafts.currentDraft(id)!)
    parentTitle.value = start.kind === 'new_related' ? start.parent.title : null
    parentBaseContent.value = start.kind === 'new_related' ? start.parent.content : ''
    stale.value = false
    openAs(id)
  }

  /**
   * Mirrors a stored draft, reading the entry it could revise: for its title, which anchor mode
   * never changes, and to say at once if it has moved on, rather than only when Save is refused. A
   * related entry's draft also reads its parent's base version, which may no longer be current.
   */
  async function mirrorReopened(draft: DraftSnapshot): Promise<void> {
    const [revises] = versionsRevisedBy(draft)
    const [parent, base] = await Promise.all([
      revises ? entries.getAggregatedEntry(revises.entry_id) : null,
      draft.kind === 'new_related' ? entries.getVersion(draft.parent.base_version_id) : null,
    ])

    mirror(draft)
    parentTitle.value = draft.kind === 'new_related' ? (parent?.title ?? null) : null
    parentBaseContent.value = base?.content ?? ''
    stale.value = parent !== null && currentVersionId(parent) !== revises?.base_version_id
  }

  /**
   * Reopens a draft left behind by a reload, with its event log intact. Null if it no longer exists.
   * One that can't be reopened opens all the same, read-only, since only its trace is out of reach.
   */
  async function resume(existingSessionId: string): Promise<DraftSnapshot | null> {
    unreadable.value = null
    stale.value = false

    let resumed: DraftSnapshot | null
    try {
      resumed = await drafts.resumeDraft(existingSessionId)
    } catch (err) {
      if (!(err instanceof DraftUnreadableError)) throw err
      await mirrorReopened(err.draft)
      openAs(existingSessionId)
      unreadable.value = err // After `openAs`, which clears it.
      return err.draft
    }
    if (!resumed) return null

    await mirrorReopened(resumed)
    openAs(existingSessionId)
    return resumed
  }

  // Catches up when another tab changed this draft: a reload shows its version, and a draft sealed
  // or discarded there closes here. Quiet unless this tab lost something or lost the draft.
  watch(
    () => (sessionId.value ? drafts.changedElsewhere[sessionId.value] : undefined),
    (change) => {
      const id = sessionId.value
      if (!change || !id) return

      // A blank copy lost nothing, so there is nothing to offer.
      const had = change.unsaved?.entry
      unsaved.value =
        had && !isBlankDraft(had.content, had.title)
          ? { title: had.title, text: docToPlainText(had.content) }
          : null
      if (change.gone) {
        sessionId.value = null
        elsewhereNotice.value = 'This draft was saved or discarded elsewhere.'
        return
      }

      mirror(drafts.currentDraft(id)!)
      reloads.value += 1
      elsewhereNotice.value = unsaved.value
        ? 'This draft was changed elsewhere at the same time, and now shows what was saved ' +
          'there. What you had here is below.'
        : null
    },
  )

  /** Forwards one `DocumentEditor` change into the session. */
  function handleChange(change: EditorChange): void {
    if (!sessionId.value) return

    content.value = change.content
    title.value = change.title
    drafts.recordChange(sessionId.value, change)
  }

  /**
   * Forwards one change to the **parent's** provisional document, anchor-mode only. The whole
   * change is passed through — not a hand-picked subset — so the parent's own authoring stream is
   * recorded exactly the way the entry's own is (see `draftsStore.recordInto`). Which anchors this
   * session placed is not forwarded at all: it is derived from the base whenever it's asked for
   * (`anchorsPlacedSince`), so there is no second copy to keep in step with the document.
   */
  function handleParentChange(change: EditorChange): void {
    if (!sessionId.value) return

    parentContent.value = change.content
    drafts.recordParentChange(sessionId.value, change)
  }

  /** Mirrors the details a form holds into the session, so a reload keeps them too. */
  function handleDetailsChange(next: EntryDetails): void {
    details.value = next
    if (sessionId.value) drafts.recordDetails(sessionId.value, next)
  }

  /**
   * Seals the session. Resolves to `null` — rather than running at all — when there is nothing
   * open or a save is already in flight, so a caller can guard a button's click handler with
   * `if (!(await session.save())) return` the same way it would have guarded on a local flag. A
   * stale version also resolves to `null`: `readOnlyReason` or `staleNotice` explains it, per kind,
   * so a caller's own error message would only repeat it less precisely. So does a draft another
   * tab wrote since, which `elsewhereNotice` explains. Any other sealing failure (empty content, "no
   * changes to save") still throws, for the caller's try/catch to report.
   */
  async function save(): Promise<Entry | null> {
    const id = sessionId.value
    if (!id || saving.value) return null

    saving.value = true
    try {
      const entry = await drafts.sealDraft(id)
      sessionId.value = null
      return entry
    } catch (err) {
      if (err instanceof DraftConflictError) return null
      if (!(err instanceof StaleVersionError)) throw err
      stale.value = true
      return null
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

  /**
   * Throws the session away on request — an explicit "Discard" click — read-only or not. It's let
   * go only once it's gone, so a failure is said where it was clicked. Resolves to whether it went:
   * one another tab wrote since stays, reloaded as that tab left it.
   */
  async function discard(): Promise<boolean> {
    const id = sessionId.value
    if (!id) return false

    try {
      // `seen` counts only for a draft the store doesn't hold: one it couldn't reopen.
      await drafts.discardDraft(id, unreadable.value?.draft.write_id ?? null)
    } catch (err) {
      if (err instanceof DraftConflictError) return false
      throw err
    }
    sessionId.value = null
    unreadable.value = null
    return true
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
    title.value = null
    parentContent.value = ''
    parentTitle.value = null
    parentBaseContent.value = ''
    details.value = emptyEntryDetails()
    saving.value = false
    kind.value = null
    stale.value = false
    elsewhereNotice.value = null
    unsaved.value = null
    unreadable.value = null
  }

  return reactive({
    sessionId,
    content,
    title,
    parentContent,
    parentTitle,
    parentBaseContent,
    details,
    saving,
    kind,
    staleNotice,
    editorKey,
    elsewhereNotice,
    unsaved,
    isOpen,
    readOnlyReason,
    readOnly,
    canSave,
    begin,
    resume,
    handleChange,
    handleParentChange,
    handleDetailsChange,
    save,
    abandon,
    discard,
    reset,
  })
}

export type DraftSession = ReturnType<typeof useDraftSession>
