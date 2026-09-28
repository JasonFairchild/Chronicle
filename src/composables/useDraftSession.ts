import { computed, reactive, ref, watch } from 'vue'
import type { EditorChange } from '@/components/DocumentEditor.vue'
import { docToPlainText, isEmptyEntry } from '@/domain/entryDocument'
import { StaleVersionError } from '@/domain/entryValidation'
import { useDraftsStore, type DraftStart } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import type { Draft, DraftSnapshot } from '@/types/draft'
import { emptyEntryDates, type Entry, type EntryDates } from '@/types/entry'

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
  const dates = ref<EntryDates>(emptyEntryDates())
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
   * started from. A claim keeps that from happening on one device (PRODUCT.md §4.8), so it is only
   * learned when a save is refused for it.
   */
  const kind = ref<DraftSnapshot['kind'] | null>(null)
  const stale = ref(false)

  const isOpen = computed(() => sessionId.value !== null)

  /** Why a stale draft can't be saved as it is, in the writer's terms; null while it can. */
  const staleNotice = computed(() => {
    if (!stale.value) return null
    return kind.value === 'new_related'
      ? 'This entry was revised after this draft began, so passages marked here can’t be saved. ' +
          'The related entry itself still can, with nothing marked.'
      : 'This entry was revised after this draft began, so saving this would overwrite that ' +
          'version. Copy what you need, then discard it.'
  })

  /** The same condition `entriesStore.requireContent` enforces, asked before the button is offered. */
  const canSave = computed(() => !isEmptyEntry(content.value, title.value))

  /**
   * What an editor showing this session is keyed on. It changes when the draft is reloaded from
   * disk under it: `DocumentEditor` reads its content once, on mount, so a remount is the swap.
   */
  const reloads = ref(0)
  const editorKey = computed(() => `${sessionId.value ?? ''}:${reloads.value}`)
  /** How many of another tab's changes to this draft are caught up on (`drafts.elsewhere`). */
  let changesSeen = 0
  /** Said when another tab changed this draft in a way the writer should know about. */
  const elsewhereNotice = ref<string | null>(null)
  /** What this tab held when another tab's version replaced it, for the writer to copy from. */
  const unsavedText = ref<string | null>(null)

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
    sessionId.value = id
  }

  /** Reopens a draft left behind by a reload, with its event log intact. Null if it no longer exists. */
  async function resume(existingSessionId: string): Promise<Draft | null> {
    const resumed = await drafts.resumeDraft(existingSessionId)
    if (!resumed) return null

    // Anchor mode never changes the parent's title, so it is read off the entry, not the draft.
    const parent =
      resumed.kind === 'new_related' ? await entries.getAggregatedEntry(resumed.parent_id) : null

    mirror(resumed, parent?.title ?? null)
    stale.value = false
    openAs(existingSessionId)
    return resumed
  }

  /** Mirrors a draft into the refs an editor binds to, whether it is beginning or resuming. */
  function mirror(draft: Draft, nextParentTitle: string | null): void {
    kind.value = draft.kind
    content.value = draft.entry.content
    title.value = draft.entry.title
    dates.value = draft.entry.dates
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
    } catch (err) {
      if (err instanceof StaleVersionError) stale.value = true
      throw err
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
    title.value = null
    parentContent.value = ''
    parentTitle.value = null
    parentBaseContent.value = ''
    dates.value = emptyEntryDates()
    saving.value = false
    kind.value = null
    stale.value = false
    elsewhereNotice.value = null
    unsavedText.value = null
  }

  return reactive({
    sessionId,
    content,
    title,
    parentContent,
    parentTitle,
    parentBaseContent,
    dates,
    saving,
    kind,
    staleNotice,
    editorKey,
    elsewhereNotice,
    unsavedText,
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
