<script setup lang="ts">
import EntryCard from '@/components/EntryCard.vue'
import type { AggregatedEntry } from '@/types/entry'

defineProps<{
  entries: AggregatedEntry[]
  emptyMessage?: string
}>()
</script>

<template>
  <section aria-label="Timeline entries">
    <p
      v-if="entries.length === 0"
      class="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]"
    >
      {{ emptyMessage ?? 'No entries yet. Create your first one above.' }}
    </p>

    <ul v-else class="space-y-3">
      <li v-for="entry in entries" :key="entry.id">
        <EntryCard :entry="entry" />
      </li>
    </ul>
  </section>
</template>
