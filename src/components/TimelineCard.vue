<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { docToPlainText } from '@/domain/entryDocument'
import type { AggregatedEntry } from '@/types/entry'

const props = defineProps<{
  entry: AggregatedEntry
}>()

/** The same flattening the detail view and search use, so a card never shows raw serialized JSON. */
const summary = computed(() => preview(docToPlainText(props.entry.content)))

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function preview(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine
}

/** Shown only once an entry has actually been revised, so an untouched entry stays quiet. */
const revisionCount = props.entry.version.total - 1
</script>

<template>
  <article
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]/40"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {{ entry.title ?? 'Entry' }}
      </span>
      <time class="text-xs text-[var(--color-text-muted)]" :datetime="entry.created_at">
        {{ formatDate(entry.created_at) }}
      </time>
    </div>

    <RouterLink
      :to="{ name: 'entry-detail', params: { id: entry.id } }"
      class="block text-sm leading-relaxed hover:text-[var(--color-accent)]"
    >
      {{ summary }}
    </RouterLink>

    <p v-if="revisionCount > 0" class="mt-2 text-xs text-[var(--color-text-muted)]">
      Revised {{ revisionCount }} {{ revisionCount === 1 ? 'time' : 'times' }}
    </p>
  </article>
</template>
