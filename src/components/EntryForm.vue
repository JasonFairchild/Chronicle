<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  submit: [content: string]
}>()

const content = ref('')
const submitting = ref(false)

defineProps<{
  disabled?: boolean
}>()

async function handleSubmit(): Promise<void> {
  const trimmed = content.value.trim()
  if (!trimmed || submitting.value) return

  submitting.value = true
  try {
    emit('submit', trimmed)
    content.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
    @submit.prevent="handleSubmit"
  >
    <label for="entry-content" class="mb-2 block text-sm font-medium"> New entry </label>
    <textarea
      id="entry-content"
      v-model="content"
      rows="4"
      class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
      placeholder="Write something worth remembering..."
      :disabled="disabled || submitting"
    />
    <div class="mt-3 flex justify-end">
      <button
        type="submit"
        class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled || submitting || !content.trim()"
      >
        Save entry
      </button>
    </div>
  </form>
</template>
