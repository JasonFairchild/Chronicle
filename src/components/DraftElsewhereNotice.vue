<script setup lang="ts">
import type { DraftSession } from '@/composables/useDraftSession'

// What another tab did to a draft open here, when the writer needs to know: it was saved or
// discarded there, or changed at the same moment, with what this tab had kept below for copying.
// Outside any composer, since a draft closed elsewhere leaves no composer to show it in.
defineProps<{
  session: DraftSession
}>()
</script>

<template>
  <div
    v-if="session.elsewhereNotice"
    class="rounded-lg border border-[var(--color-border)] p-3 text-sm"
    role="status"
  >
    <p>{{ session.elsewhereNotice }}</p>
    <div v-if="session.unsaved" class="mt-2 text-[var(--color-text-muted)]">
      <p v-if="session.unsaved.title" class="font-medium">{{ session.unsaved.title }}</p>
      <p class="whitespace-pre-wrap">{{ session.unsaved.text }}</p>
    </div>
  </div>
</template>
