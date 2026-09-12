<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { previewText } from '@/domain/entryDocument'
import type { AggregatedEntry } from '@/types/entry'
import { entryWhenLines, formatDate } from '@/utils/format'

const props = defineProps<{
  entry: AggregatedEntry
}>()

/** The same flattening the detail view and search use, so a card never shows raw serialized JSON. */
const summary = computed(() => previewText(props.entry.content))

/** Shown only once an entry has actually been revised, so an untouched entry stays quiet. */
const revisionCount = computed(() => props.entry.version.total - 1)

/**
 * The dates the writer gave. The card's own timestamp stays what it has always been — when the
 * entry entered Chronicle — so these are additions to it rather than a replacement for it.
 */
const whenLines = computed(() => entryWhenLines(props.entry.dates))
</script>

<template>
  <article
    class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]/40"
  >
    <!--
      A card has room for both a name and the text, so it shows the title only when there is one
      rather than falling back: the summary below is already the entry's opening words, and putting
      those in the slot above would say the same thing twice. The date is the half that is always
      there, so it holds the row on its own for an entry nobody named.
    -->
    <div class="mb-2 flex items-center justify-between gap-3">
      <span
        v-if="entry.title"
        class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]"
      >
        {{ entry.title }}
      </span>
      <time class="ml-auto text-xs text-[var(--color-text-muted)]" :datetime="entry.created_at">
        {{ formatDate(entry.created_at) }}
      </time>
    </div>

    <RouterLink
      :to="{ name: 'entry-detail', params: { id: entry.id } }"
      class="block text-sm leading-relaxed hover:text-[var(--color-accent)]"
    >
      {{ summary }}
    </RouterLink>

    <p v-for="line in whenLines" :key="line" class="mt-2 text-xs text-[var(--color-text-muted)]">
      {{ line }}
    </p>

    <p v-if="revisionCount > 0" class="mt-2 text-xs text-[var(--color-text-muted)]">
      Revised {{ revisionCount }} {{ revisionCount === 1 ? 'time' : 'times' }}
    </p>
  </article>
</template>
