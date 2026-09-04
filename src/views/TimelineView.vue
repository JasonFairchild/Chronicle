<script setup lang="ts">
import { onMounted } from 'vue'
import EntryForm from '@/components/EntryForm.vue'
import EntryList from '@/components/EntryList.vue'
import { useEntriesStore } from '@/stores/entriesStore'

const store = useEntriesStore()

onMounted(() => {
  void store.loadRootEntries()
})

async function handleCreate(content: string): Promise<void> {
  await store.createTextEntry(content)
}
</script>

<template>
  <div class="space-y-8">
    <section>
      <h1 class="mb-2 text-2xl font-semibold tracking-tight">Timeline</h1>
      <p class="mb-6 text-sm text-[var(--color-text-muted)]">
        Root entries appear here, newest first. Each record is immutable — changes become related
        entries in later phases.
      </p>
      <EntryForm :disabled="store.loading" @submit="handleCreate" />
    </section>

    <section>
      <h2 class="mb-4 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Entries
      </h2>
      <p v-if="store.error" class="mb-4 text-sm text-red-500" role="alert">
        {{ store.error }}
      </p>
      <EntryList :entries="store.rootEntries" />
    </section>
  </div>
</template>
