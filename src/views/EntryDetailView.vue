<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { AggregatedEntry, Entry } from '@/types/entry'
import { useEntriesStore } from '@/stores/entriesStore'

const props = defineProps<{
  id: string
}>()

const store = useEntriesStore()
const entry = ref<Entry | null>(null)
const aggregated = ref<AggregatedEntry | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const title = computed(() =>
  aggregated.value?.content ? 'Entry detail' : entry.value ? 'Entry detail' : 'Entry not found',
)

async function loadEntry(entryId: string): Promise<void> {
  loading.value = true
  error.value = null

  try {
    entry.value = await store.getEntry(entryId)
    aggregated.value = entry.value ? await store.getAggregatedEntry(entryId) : null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load entry'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadEntry(props.id)
})

watch(
  () => props.id,
  (entryId) => {
    void loadEntry(entryId)
  },
)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(iso))
}
</script>

<template>
  <div class="space-y-6">
    <RouterLink to="/" class="inline-flex text-sm text-[var(--color-accent)] hover:underline">
      ← Back to timeline
    </RouterLink>

    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading entry...</div>

    <div v-else-if="error" class="text-sm text-red-500" role="alert">{{ error }}</div>

    <div v-else-if="!entry" class="text-sm text-[var(--color-text-muted)]">Entry not found.</div>

    <article
      v-else
      class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
    >
      <header class="mb-4 border-b border-[var(--color-border)] pb-4">
        <h1 class="text-xl font-semibold">{{ title }}</h1>
        <p class="mt-1 text-sm text-[var(--color-text-muted)]">
          Created {{ formatDate(entry.created_at) }}
        </p>
      </header>

      <div class="whitespace-pre-wrap text-sm leading-relaxed">
        {{ aggregated?.content ?? entry.content }}
      </div>

      <footer
        v-if="aggregated && aggregated.applied_relations.length > 0"
        class="mt-6 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]"
      >
        Applied relations: {{ aggregated.applied_relations.join(', ') }}
      </footer>
    </article>
  </div>
</template>
