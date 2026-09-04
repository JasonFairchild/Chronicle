<script setup lang="ts">
import TimelineCard from '@/components/TimelineCard.vue'
import type { Entry } from '@/types/entry'

defineProps<{
  entries: Entry[]
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
        <TimelineCard :entry="entry" />
      </li>
    </ul>
  </section>
</template>
