<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { isEmptyDocument } from '@/domain/entryDocument'
import { useDraftsStore } from '@/stores/draftsStore'
import { toErrorMessage } from '@/utils/format'

const props = defineProps<{
  disabled?: boolean
}>()

const drafts = useDraftsStore()

/**
 * Typing here is a draft session, not an entry. Nothing reaches the entries table until someone
 * presses Save, and nothing is lost in the meantime: the buffer flushes on a short debounce, so a
 * closed laptop costs a fraction of a sentence rather than the whole thought.
 */
const sessionId = ref(drafts.beginDraft({ kind: 'new_root' }))
const content = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

const canSave = computed(() => !isEmptyDocument(content.value) && !props.disabled && !saving.value)

function handleChange(change: EditorChange): void {
  content.value = change.content
  drafts.recordChange(sessionId.value, change)
}

async function handleSubmit(): Promise<void> {
  if (!canSave.value) return

  saving.value = true
  error.value = null

  try {
    // Sealing refreshes the timeline through the entries store, so there is nothing to tell a
    // parent about: the outcome is already visible wherever entries are read.
    await drafts.sealDraft(sessionId.value)
    // A sealed session is finished. The next entry is a new one, and re-keying the editor is what
    // gives it a genuinely empty document rather than a cleared-out old one.
    sessionId.value = drafts.beginDraft({ kind: 'new_root' })
    content.value = ''
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to save entry')
  } finally {
    saving.value = false
  }
}

// Whatever is pending has to reach disk before this component goes away — and if this composer
// was opened and never typed into, there is nothing to keep, so the session is dropped rather
// than left open forever.
onBeforeUnmount(() => {
  void drafts.abandonDraft(sessionId.value)
})
</script>

<template>
  <form
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
    @submit.prevent="handleSubmit"
  >
    <p class="mb-2 text-sm font-medium">New entry</p>

    <DocumentEditor
      :key="sessionId"
      label="New entry"
      with-title
      :disabled="disabled || saving"
      @change="handleChange"
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
