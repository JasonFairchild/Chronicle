<script lang="ts">
import type { NarrativeRelation } from '@/types/entry'

/** What the child does to the selected passage. `comment` leaves the text alone. */
export type ChildOpKind = 'comment' | 'strike'

export interface ChildEntrySubmission {
  relationType: NarrativeRelation
  opKind: ChildOpKind
  content: string
  /** Replacement wording shown beside a strike. Empty unless the user supplied one. */
  insertion: string
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  /** The passage the user has selected in the parent, or null for a note about the whole entry. */
  quote?: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [submission: ChildEntrySubmission]
}>()

const relationType = ref<NarrativeRelation>('annotation')
const opKind = ref<ChildOpKind>('comment')
const content = ref('')
const insertion = ref('')
const submitting = ref(false)

const hasSelection = computed(() => Boolean(props.quote))

/**
 * Striking a passage only makes sense against a selection, and proposing replacement wording only
 * makes sense alongside a strike. There is no `replace` op: a strike plus an insert is that gesture.
 */
const canStrike = computed(() => hasSelection.value)
const showInsertion = computed(() => canStrike.value && opKind.value === 'strike')

const canSubmit = computed(
  () => Boolean(content.value.trim()) && !props.disabled && !submitting.value,
)

function handleSubmit(): void {
  if (!canSubmit.value) return

  submitting.value = true
  try {
    emit('submit', {
      relationType: relationType.value,
      opKind: canStrike.value ? opKind.value : 'comment',
      content: content.value.trim(),
      insertion: showInsertion.value ? insertion.value.trim() : '',
    })
    content.value = ''
    insertion.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    @submit.prevent="handleSubmit"
  >
    <p v-if="hasSelection" class="mb-3 text-sm text-[var(--color-text-muted)]">
      About: <span class="italic">“{{ quote }}”</span>
    </p>
    <p v-else class="mb-3 text-sm text-[var(--color-text-muted)]">
      About this entry as a whole. Select text above to attach it to a passage instead.
    </p>

    <div class="mb-3 flex flex-wrap gap-3">
      <label class="text-sm">
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

      <label v-if="canStrike" class="text-sm">
        <span class="mr-2">Action</span>
        <select
          v-model="opKind"
          aria-label="Anchor action"
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm"
        >
          <option value="comment">Comment on it</option>
          <option value="strike">Strike it</option>
        </select>
      </label>
    </div>

    <label for="child-content" class="mb-2 block text-sm font-medium">Your note</label>
    <textarea
      id="child-content"
      v-model="content"
      rows="3"
      class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
      placeholder="Why does this need saying?"
      :disabled="disabled || submitting"
    />

    <template v-if="showInsertion">
      <label for="child-insertion" class="mt-3 mb-2 block text-sm font-medium">
        Replacement wording
      </label>
      <input
        id="child-insertion"
        v-model="insertion"
        type="text"
        class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
        placeholder="Optional. Shown beside the struck text, never replacing it."
        :disabled="disabled || submitting"
      />
    </template>

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
