<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import DocumentEditor from '@/components/DocumentEditor.vue'
import EntryDatesFields from '@/components/EntryDatesFields.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { toErrorMessage } from '@/utils/format'

const props = defineProps<{
  disabled?: boolean
}>()

/**
 * Typing here is a draft session, not an entry. Nothing reaches the entries table until someone
 * presses Save, and nothing is lost in the meantime: the buffer flushes on a short debounce, so a
 * closed laptop costs a fraction of a sentence rather than the whole thought.
 *
 * Opened immediately rather than on the first keystroke: the session has to exist before the editor
 * can report into it, and an untouched one costs nothing — nothing is written until something is
 * typed, and `abandon` below drops a session nobody used.
 */
const session = useDraftSession()
session.begin({ kind: 'new_root' })

const error = ref<string | null>(null)

/** The session's own condition, plus the two this composer adds: not busy, not switched off. */
const canSave = computed(() => session.canSave && !props.disabled && !session.saving)

async function handleSubmit(): Promise<void> {
  if (!canSave.value) return

  error.value = null

  try {
    // Sealing refreshes the timeline through the entries store, so there is nothing to tell a
    // parent about: the outcome is already visible wherever entries are read.
    if (!(await session.save())) return
    // A sealed session is finished. The next entry is a new one, and re-keying the editor is what
    // gives it a genuinely empty document rather than a cleared-out old one.
    session.begin({ kind: 'new_root' })
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to save entry')
  }
}

// Whatever is pending has to reach disk before this component goes away — and if this composer
// was opened and never typed into, there is nothing to keep, so the session is dropped rather
// than left open forever.
onBeforeUnmount(() => {
  void session.abandon()
})
</script>

<template>
  <form
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
    @submit.prevent="handleSubmit"
  >
    <p class="mb-2 text-sm font-medium">New entry</p>

    <EntryDatesFields
      :model-value="session.dates"
      :disabled="disabled || session.saving"
      @update:model-value="session.handleDatesChange"
    />

    <DocumentEditor
      :key="session.sessionId ?? ''"
      label="New entry"
      with-title
      :disabled="disabled || session.saving"
      @change="session.handleChange"
    />

    <p v-if="error" class="mt-2 text-sm text-[var(--color-error)]" role="alert">{{ error }}</p>

    <div class="mt-3 flex items-center justify-between gap-3">
      <p class="text-xs text-[var(--color-text-muted)]">
        Saved as a draft while you write. Nothing joins the timeline until you save it.
      </p>
      <button
        type="submit"
        class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canSave"
      >
        Save entry
      </button>
    </div>
  </form>
</template>
