<script lang="ts">
export interface ConnectionCandidate {
  id: string
  /** What to call this entry in the picker: its title, or a trimmed preview of its text. */
  label: string
}

export interface ConnectionSubmission {
  toId: string
  /** The arrow's wording. Free text while the vocabulary is still settling. */
  label: string
  content: string
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  /** Entries this one can point at. The source is expected to be filtered out already. */
  candidates: ConnectionCandidate[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [submission: ConnectionSubmission]
}>()

const toId = ref('')
const label = ref('')
const content = ref('')

// Direction is meaningful, so a connection needs a destination and nothing else is optional about
// it. The note and the wording are both allowed to be empty: the edge itself is the claim.
//
// There is no in-flight flag of this form's own: `submit` is emitted synchronously and this
// function has returned before Vue renders again, so such a flag could never be observed true.
// Whether a save is actually running is the parent's to know, and it says so through `disabled`.
const canSubmit = computed(() => Boolean(toId.value) && !props.disabled)

function handleSubmit(): void {
  if (!canSubmit.value) return

  emit('submit', {
    toId: toId.value,
    label: label.value.trim(),
    content: content.value.trim(),
  })
  toId.value = ''
  label.value = ''
  content.value = ''
}
</script>

<template>
  <form
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    @submit.prevent="handleSubmit"
  >
    <p v-if="candidates.length === 0" class="text-sm text-[var(--color-text-muted)]">
      There is nothing else to connect to yet. Write another entry first.
    </p>

    <template v-else>
      <label for="connection-target" class="mb-2 block text-sm font-medium">Connect to</label>
      <select
        id="connection-target"
        v-model="toId"
        class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm"
        :disabled="disabled"
      >
        <option value="">Choose an entry</option>
        <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">
          {{ candidate.label }}
        </option>
      </select>

      <label for="connection-label" class="mt-3 mb-2 block text-sm font-medium">
        How they relate
      </label>
      <input
        id="connection-label"
        v-model="label"
        type="text"
        class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
        placeholder="led to, answers, contradicts..."
        :disabled="disabled"
      />

      <label for="connection-note" class="mt-3 mb-2 block text-sm font-medium">
        Why they relate
      </label>
      <textarea
        id="connection-note"
        v-model="content"
        rows="2"
        class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
        placeholder="Optional. A connection is an entry too, so it can be annotated later."
        :disabled="disabled"
      />

      <div class="mt-3 flex justify-end">
        <button
          type="submit"
          class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canSubmit"
        >
          Add connection
        </button>
      </div>
    </template>
  </form>
</template>
