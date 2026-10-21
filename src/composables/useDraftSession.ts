import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { EditorChange } from '@/components/DocumentEditor.vue'
import { docToPlainText, isEmptyDocument } from '@/domain/entryDocument'
import { StaleVersionError } from '@/domain/entryValidation'
import { currentVersionId } from '@/domain/reconstructEntryState'
import { DraftUnreadableError, useDraftsStore, type DraftStart } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import { versionsRevisedBy, type Draft, type DraftSnapshot } from '@/types/draft'
import { emptyEntryDetails, entryDetailsOf, type Entry, type EntryDetails } from '@/types/entry'

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
   * The parent as it stood when this session began — `Draft.parent.base_content`, mirrored here the
   * same way `parentContent` itself is, and never reassigned while the session runs. What
   * `DocumentEditor`'s `anchor-base-content` prop is seeded from on a resume, so an anchor placed
   * before a reload still reads as this session's own rather than as an earlier related entry's.
   */
  const parentBaseContent = ref('')
  /**
   * What the open draft is, and whether the entry it could revise has moved past the version it
   * started from. A claim keeps that from happening (PRODUCT.md §4.8) all but in a race, so it is
   * learned when the draft is reopened, or when a save is refused for it.
   */
  const kind = ref<DraftSnapshot['kind'] | null>(null)
  const stale = ref(false)

  const isOpen = computed(() => sessionId.value !== null)

  /**
   * Why a stale related entry's marks can't be saved. The entry itself still can, once they're
   * removed, so unlike a stale revision it stays open for editing (`readOnlyReason`).
   */
  const staleNotice = computed(() =>
    stale.value && kind.value === 'new_related'
      ? 'This entry was revised after this draft began, so passages marked here can’t be saved. ' +
        'The related entry itself still can, with nothing marked.'
      : null,
  )

  /** The same condition `entriesStore.requireContent` enforces, asked before a save is attempted. */
  const canSave = computed(() => !isEmptyDocument(content.value))

  /**
   * What an editor showing this session is keyed on. It changes when the draft is reloaded from
   * disk under it, or turns read-only: `DocumentEditor` reads its content and whether it can be
   * typed in once, on mount, so a remount is the swap.
   */
  const reloads = ref(0)
  const editorKey = computed(
    () => `${sessionId.value ?? ''}:${reloads.value}:${readOnly.value ? 'read' : 'write'}`,
  )
  /** How many of another tab's changes to this draft are caught up on (`drafts.elsewhere`). */
  let changesSeen = 0
  /** Said when another tab changed this draft in a way the writer should know about. */
  const elsewhereNotice = ref<string | null>(null)
  /** What this tab held when another tab's version replaced it, for the writer to copy from. */
  const unsavedText = ref<string | null>(null)
  /**
   * The draft `resume` found but couldn't reopen, held here so every composer says so the same way,
   * and so `discard` can still throw it away.
   */
  const unreadable = shallowRef<DraftUnreadableError | null>(null)
  /**
   * Why the draft is shown only to copy from, with nothing that could change it; null while it can
   * be written. Its words are all there either way, but a change would have nowhere to go: one that
   * can't be reopened has no trace to carry on, and a stale revision could never be saved.
   */
  const readOnlyReason = computed(() => {
    if (unreadable.value) return unreadable.value.message
    if (isOpen.value && stale.value && kind.value === 'revision') {
      return (
        'This entry was revised after this draft began, so saving this would overwrite ' +
        'that version.'
      )
    }
    return null
  })
  const readOnly = computed(() => readOnlyReason.value !== null)
  /** What a host mounts its composer on: a draft open for editing, or one shown read-only. */
  const hasDraft = computed(() => isOpen.value || readOnly.value)

  /**
   * Catches up when another tab changed this draft: a reload shows its version, and a draft sealed
   * or discarded there closes here. Quiet unless this tab lost something or lost the draft.
   */
  watch(
    () => (sessionId.value ? drafts.elsewhere[sessionId.value] : undefined),
    (change) => {
      const id = sessionId.value
      if (!change || !id || change.count <= changesSeen) return
      changesSeen = change.count

      unsavedText.value = change.unsaved ? docToPlainText(change.unsaved) : null
      if (change.gone) {
        sessionId.value = null
        elsewhereNotice.value = 'This draft was saved or discarded elsewhere.'
        return
      }

      mirror(drafts.currentDraft(id)!, parentTitle.value)
      reloads.value += 1
      elsewhereNotice.value = unsavedText.value
        ? 'This draft was changed elsewhere at the same time, and now shows what was saved ' +
          'there. What you had here is below.'
        : null
    },
  )

  /** Opens a brand-new session — nothing is written until the first real change. */
  function begin(start: DraftStart): void {
    const id = drafts.beginDraft(start)

    mirror(drafts.currentDraft(id)!, start.kind === 'new_related' ? start.parent.title : null)
    stale.value = false
    openAs(id)
  }

  /** Takes a draft as this session's from here on, with nothing another tab did before now. */
  function openAs(id: string): void {
    changesSeen = drafts.elsewhere[id]?.count ?? 0
    elsewhereNotice.value = null
    unsavedText.value = null
    unreadable.value = null
    sessionId.value = id
  }

  /**
   * Reopens a draft left behind by a reload, with its event log intact. Null if it no longer exists,
   * or if it can't be reopened: then `unreadable` holds it, and its words are mirrored all the same,
   * since only its trace is out of reach, for a composer to show them read-only.
   */
  async function resume(existingSessionId: string): Promise<Draft | null> {
    unreadable.value = null
    stale.value = false

    let resumed: Draft | null
    try {
      resumed = await drafts.resumeDraft(existingSessionId)
    } catch (err) {
      if (!(err instanceof DraftUnreadableError)) throw err
      await mirrorReopened(err.draft)
      unreadable.value = err
      return null
    }
    if (!resumed) return null

    await mirrorReopened(resumed)
    openAs(existingSessionId)
    return resumed
  }

  /**
   * Mirrors a stored draft, reading the entry it could revise: for its title, which anchor mode
   * never changes, and to say at once if it has moved on, rather than only when Save is refused.
   */
  async function mirrorReopened(draft: DraftSnapshot): Promise<void> {
    const [revises] = versionsRevisedBy(draft)
    const parent = revises ? await entries.getAggregatedEntry(revises.entry_id) : null

    mirror(draft, draft.kind === 'new_related' ? (parent?.title ?? null) : null)
    stale.value = parent !== null && currentVersionId(parent) !== revises?.base_version_id
  }

  /** Mirrors a draft into the refs an editor binds to, whether it is beginning or resuming. */
  function mirror(draft: DraftSnapshot, nextParentTitle: string | null): void {
    kind.value = draft.kind
    content.value = draft.entry.content
    title.value = draft.entry.title
    details.value = entryDetailsOf(draft.entry)
    parentContent.value = draft.kind === 'new_related' ? draft.parent.content : ''
    parentBaseContent.value = draft.kind === 'new_related' ? draft.parent.base_content : ''
    parentTitle.value = nextParentTitle
  }

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
   * so a caller's own error message would only repeat it less precisely. Any other sealing failure
   * (empty content, "no changes to save") still throws, for the caller's try/catch to report.
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
   * Throws the session away on request — an explicit "Discard" click — or the draft it couldn't
   * reopen. Either is let go only once it's gone, so a failure is said where it was clicked.
   */
  async function discard(): Promise<void> {
    const id = sessionId.value ?? unreadable.value?.draft.session_id
    if (!id) return

    await drafts.discardDraft(id)
    sessionId.value = null
    unreadable.value = null
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
    unsavedText.value = null
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
    unsavedText,
    unreadable,
    isOpen,
    readOnlyReason,
    readOnly,
    hasDraft,
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
