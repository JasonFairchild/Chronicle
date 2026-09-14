<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { previewText } from '@/domain/entryDocument'
import type { AggregatedEntry } from '@/types/entry'
import { entryLabel, entryWhenLines, formatDate } from '@/utils/format'

const props = defineProps<{
  entry: AggregatedEntry
}>()

/** The same flattening the detail view and search use, so a card never shows raw serialized JSON. */
const summary = computed(() => previewText(props.entry.content))

/**
 * The dates the writer gave. The card's own timestamp stays what it has always been — when the
 * entry entered Chronicle — so these are additions to it rather than a replacement for it.
 */
const whenLines = computed(() => entryWhenLines(props.entry.dates))

/** A short, stable name for the card as a whole — its accessible name, not its full text. */
const label = computed(() => entryLabel(props.entry))
</script>

<template>
  <RouterLink
    :to="{ name: 'entry-detail', params: { id: entry.id } }"
    :aria-label="label"
    class="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
  >
    <!--
      Two columns, not two rows: all of this entry's own content — name, summary, dates, and
      whatever a caller puts in `extra` — stacks together in the left column, so none of it waits on
      the shorter, independent right column (badge, date) to finish before it can start.
    -->
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <span
          v-if="entry.title"
          class="block truncate text-xs uppercase tracking-wide text-[var(--color-text-muted)]"
        >
          {{ entry.title }}
        </span>

        <!-- No title falls back to the summary itself, not a separate repeated stand-in. -->
        <p class="text-sm leading-relaxed" :class="{ 'mt-1': entry.title }">{{ summary }}</p>

        <p
          v-for="line in whenLines"
          :key="line"
          class="mt-2 text-xs text-[var(--color-text-muted)]"
        >
          {{ line }}
        </p>

        <slot name="extra" />
      </div>

      <div class="flex shrink-0 flex-col items-end gap-1">
        <slot name="badge" />
        <time class="text-xs text-[var(--color-text-muted)]" :datetime="entry.created_at">
          {{ formatDate(entry.created_at) }}
        </time>
      </div>
    </div>
  </RouterLink>
</template>
