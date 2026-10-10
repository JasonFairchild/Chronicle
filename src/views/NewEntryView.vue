<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import DraftElsewhereNotice from '@/components/DraftElsewhereNotice.vue'
import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { useSealDraft } from '@/composables/useSealDraft'
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
session.begin({ kind: 'new_root' })

const error = ref<string | null>(null)
const handleSave = useSealDraft(session, error)

/** Throws the draft away and starts over. Re-keying the editor gives it a genuinely empty document. */
async function handleDiscard(): Promise<void> {
  error.value = null

  try {
    await session.discard()
    session.begin({ kind: 'new_root' })
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to discard draft')
  }
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

    <DraftElsewhereNotice :session="session" />

    <EntryComposer
      :session="session"
      label="New entry"
      save-label="Save entry"
      @save="handleSave"
      @discard="handleDiscard"
    >
      <template #notices>
        <p v-if="error" class="text-sm text-[var(--color-error)]" role="alert">{{ error }}</p>
      </template>
    </EntryComposer>
  </div>
</template>
