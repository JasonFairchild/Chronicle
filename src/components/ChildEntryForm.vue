<script lang="ts">
import type { NarrativeRelation } from '@/types/entry'

export interface ChildEntrySubmission {
  relationType: NarrativeRelation
  content: string
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [submission: ChildEntrySubmission]
}>()

const relationType = ref<NarrativeRelation>('annotation')
const content = ref('')

const canSubmit = computed(() => Boolean(content.value.trim()) && !props.disabled)

function handleSubmit(): void {
  if (!canSubmit.value) return

  emit('submit', { relationType: relationType.value, content: content.value.trim() })
  content.value = ''
}
</script>

<template>
  <form
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    @submit.prevent="handleSubmit"
  >
    <p class="mb-3 text-sm text-[var(--color-text-muted)]">
      About this entry as a whole. To attach a note to a specific passage, anchor it instead.
    </p>

    <label class="mb-3 block text-sm">
      <span class="mr-2">Kind</span>
      <select
        v-model="relationType"
        aria-label="Relation type"
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm"
      >
        <option value="annotation">Annotation</option>
        <option value="update">Update</option>
      </select>
    </label>

    <label for="child-content" class="mb-2 block text-sm font-medium">Your note</label>
    <textarea
      id="child-content"
      v-model="content"
      rows="3"
      class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
      placeholder="Why does this need saying?"
      :disabled="disabled"
    />

    <div class="mt-3 flex justify-end">
      <button
        type="submit"
        class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canSubmit"
      >
        Add entry
      </button>
    </div>
  </form>
</template>
