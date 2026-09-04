<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { Entry } from '@/types/entry'

defineProps<{
  entry: Entry
}>()

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function preview(content: string): string {
  const singleLine = content.replace(/\s+/g, ' ').trim()
  return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine
}
</script>

<template>
  <article
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]/40"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {{ entry.type }}
      </span>
      <time class="text-xs text-[var(--color-text-muted)]" :datetime="entry.created_at">
        {{ formatDate(entry.created_at) }}
      </time>
    </div>

    <RouterLink
      :to="{ name: 'entry-detail', params: { id: entry.id } }"
      class="block text-sm leading-relaxed hover:text-[var(--color-accent)]"
    >
      {{ preview(entry.content) }}
    </RouterLink>
  </article>
</template>
