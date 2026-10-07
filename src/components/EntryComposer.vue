<script setup lang="ts">
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import EntryDatesFields from '@/components/EntryDatesFields.vue'
import type { DraftSession } from '@/composables/useDraftSession'

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
}>()

const emit = defineEmits<{
  save: []
  discard: []
  change: [change: EditorChange] // After the session has it, for an owner that reads more of it.
}>()

function handleChange(change: EditorChange): void {
  props.session.handleChange(change)
  emit('change', change)
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

      <p v-if="session.staleNotice" class="mt-2 text-sm text-[var(--color-error)]" role="status">
        {{ session.staleNotice }}
      </p>
    </div>

    <p class="text-xs text-[var(--color-text-muted)]">
      Saved as a draft while you write. Nothing is added to your record until you save it.
    </p>

    <slot name="notices" />

    <EntryDatesFields
      :model-value="session.dates"
      :disabled="session.saving"
      @update:model-value="session.handleDatesChange"
    />

    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
        :disabled="session.saving"
        @click="emit('discard')"
      >
        Discard
      </button>
      <!--
        `canSave` rather than a check of its own: asking the same question the seal will ask keeps
        the button from offering a save the store is bound to refuse.
      -->
      <button
        type="button"
        class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="session.saving || !session.canSave"
        @click="emit('save')"
      >
        {{ saveLabel }}
      </button>
    </div>
  </div>
</template>
