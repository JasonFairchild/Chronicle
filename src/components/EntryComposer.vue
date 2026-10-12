<script setup lang="ts">
import { ref } from 'vue'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import EntryDetailsFields from '@/components/EntryDetailsFields.vue'
import type { DraftSession } from '@/composables/useDraftSession'
import { toErrorMessage } from '@/utils/format'

/**
 * The one way an entry is written: its document, then its detail fields, then Discard and Save.
 *
 * Holds no session of its own, like `RelatedEntryComposer`: whoever mounts it begins or resumes the
 * session and decides what a save or a discard leads to.
 *
 * Not a `<form>`: Enter in a field (a time note, the link address) would submit it and save the
 * entry mid-thought.
 */
const props = defineProps<{
  session: DraftSession
  label: string // The editor's accessible name.
  saveLabel: string
  // Props rather than emits, so they can be awaited: a failure is said here, beside the buttons,
  // and goes when this composer does. Bound as `@save` and `@discard` all the same.
  onSave: () => Promise<void> | void
  onDiscard: () => Promise<void> | void
}>()

const emit = defineEmits<{
  change: [change: EditorChange] // After the session has it, for an owner that reads more of it.
}>()

const error = ref<string | null>(null) // Why Save or Discard did nothing; cleared by any change.

function handleChange(change: EditorChange): void {
  error.value = null
  props.session.handleChange(change)
  emit('change', change)
}

/** Asks the same question the seal will, so the owner is never handed a save bound to fail. */
async function handleSave(): Promise<void> {
  if (!props.session.canSave) {
    error.value = 'Write something in the entry first. A title alone can’t be saved.'
    return
  }
  await run(props.onSave, 'Failed to save entry')
}

/** Runs the owner's handler for one button, saying why if it fails. */
async function run(action: () => Promise<void> | void, fallback: string): Promise<void> {
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = toErrorMessage(err, fallback)
  }
}
</script>

<template>
  <div class="space-y-3">
    <div>
      <DocumentEditor
        :key="session.editorKey"
        :label="label"
        with-title
        :title="session.title"
        :content="session.content"
        :disabled="session.saving"
        @change="handleChange"
      />

      <p v-if="error" class="mt-2 text-sm text-[var(--color-error)]" role="alert">
        {{ error }}
      </p>

      <p v-if="session.staleNotice" class="mt-2 text-sm text-[var(--color-error)]" role="status">
        {{ session.staleNotice }}
      </p>
    </div>

    <p class="text-xs text-[var(--color-text-muted)]">
      Saved as a draft while you write. Nothing is added to your record until you save it.
    </p>

    <slot name="notices" />

    <EntryDetailsFields
      :model-value="session.details"
      :disabled="session.saving"
      @update:model-value="session.handleDetailsChange"
    />

    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
        :disabled="session.saving"
        @click="run(onDiscard, 'Failed to discard draft')"
      >
        Discard
      </button>
      <!--
        Disabled only while saving. With nothing written it stays enabled and says why when
        pressed: a disabled button explains nothing and can't be reached by Tab.
      -->
      <button
        type="button"
        class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="session.saving"
        @click="handleSave"
      >
        {{ saveLabel }}
      </button>
    </div>
  </div>
</template>
