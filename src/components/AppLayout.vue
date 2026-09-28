<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { provideLayoutWidth } from '@/composables/useLayoutWidth'
import { useStoragePersistence } from '@/composables/useStoragePersistence'

const layoutWidth = provideLayoutWidth()
const storage = useStoragePersistence()
</script>

<template>
  <div class="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
    <header class="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <RouterLink to="/" class="text-lg font-semibold tracking-tight"> Chronicle </RouterLink>
        <nav class="flex items-center gap-4 text-sm">
          <RouterLink to="/" class="hover:text-[var(--color-accent)]">Timeline</RouterLink>
          <RouterLink to="/drafts" class="hover:text-[var(--color-accent)]">Drafts</RouterLink>
        </nav>
      </div>
    </header>

    <main class="mx-auto px-4 py-8" :class="layoutWidth === 'wide' ? 'max-w-[96rem]' : 'max-w-3xl'">
      <p
        v-if="storage.showNotice.value"
        class="mb-6 flex items-start justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]"
        role="status"
      >
        <span>
          This browser may clear Chronicle’s data when space runs low. Installing Chronicle (your
          browser’s Install or Add to Home Screen) usually lets it keep it.
        </span>
        <button
          type="button"
          class="shrink-0 hover:text-[var(--color-accent)]"
          @click="storage.dismiss"
        >
          Dismiss
        </button>
      </p>

      <slot />
    </main>
  </div>
</template>
