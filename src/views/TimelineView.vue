<script setup lang="ts">
import { onMounted } from 'vue'
import EntryList from '@/components/EntryList.vue'
import { useEntriesStore } from '@/stores/entriesStore'

/** A plain list for now; what the timeline is meant to become is PRODUCT.md §5.6. */
const store = useEntriesStore()

onMounted(() => {
  void store.loadRootEntries()
})
</script>

<template>
  <div class="space-y-8">
    <section>
      <h1 class="mb-2 text-2xl font-semibold tracking-tight">Timeline</h1>
      <p class="mb-6 text-sm text-[var(--color-text-muted)]">
        Root entries appear here, newest first. Each record is immutable: edits append a new version
        and notes become related entries.
      </p>
    </section>

    <section>
      <h2 class="mb-4 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Entries
      </h2>
      <p v-if="store.error" class="mb-4 text-sm text-[var(--color-error)]" role="alert">
        {{ store.error }}
      </p>
      <EntryList :entries="store.rootEntries" />
    </section>
  </div>
</template>
