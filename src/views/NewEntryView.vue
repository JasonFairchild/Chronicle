<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import DraftElsewhereNotice from '@/components/DraftElsewhereNotice.vue'
import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { useSealDraft } from '@/composables/useSealDraft'
import { useDraftToResume } from '@/router/draftQuery'
import { toErrorMessage } from '@/utils/format'

/**
 * Where a new entry is written, and where the app opens. Typing here is a draft session, not an
 * entry. Nothing reaches the entries table until someone presses Save, and nothing is lost in the
 * meantime: the buffer flushes on a short timer, so a closed laptop costs a fraction of a sentence
 * rather than the whole thought.
 *
 * Opened immediately rather than on the first keystroke: the session has to exist before the editor
 * can report into it, and an untouched one costs nothing — nothing is written until something is
 * typed, and `abandon` below drops a session nobody used.
 */
const session = useDraftSession()
const resumeError = ref<string | null>(null)

const resumeDraftId = useDraftToResume().value
if (resumeDraftId) void reopen(resumeDraftId)
else session.begin({ kind: 'new_root' })

/**
 * Reopens the draft this page was linked to. One that's gone, or failed to reopen, gives way to a
 * fresh draft, as on an unlinked visit; one that can't be reopened shows read-only instead.
 */
async function reopen(id: string): Promise<void> {
  try {
    if (await session.resume(id)) return
  } catch (err) {
    resumeError.value = toErrorMessage(err, 'Failed to resume draft')
  }
  if (!session.readOnly) session.begin({ kind: 'new_root' })
}

const handleSave = useSealDraft(session)

/** Throws the draft away and starts over. Re-keying the editor gives it a genuinely empty document. */
async function handleDiscard(): Promise<void> {
  await session.discard()
  session.begin({ kind: 'new_root' })
}

// Whatever is pending has to reach disk before this page goes away — and if it was opened and
// never typed into, there is nothing to keep, so the session is dropped rather than left open.
onBeforeUnmount(() => {
  void session.abandon()
})
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold tracking-tight">New entry</h1>

    <p v-if="resumeError" class="text-sm text-[var(--color-error)]" role="alert">
      {{ resumeError }}
    </p>

    <DraftElsewhereNotice :session="session" />

    <!-- A draft saved or discarded in another tab closes here once this tab is returned to. -->
    <button
      v-if="!session.hasDraft && session.elsewhereNotice"
      type="button"
      class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      @click="session.begin({ kind: 'new_root' })"
    >
      Start a new entry
    </button>

    <!-- Only once there's a draft: an editor shown before a resume lands drops what's typed. -->
    <EntryComposer
      v-if="session.hasDraft"
      :session="session"
      label="New entry"
      save-label="Save entry"
      @save="handleSave"
      @discard="handleDiscard"
    />
  </div>
</template>
