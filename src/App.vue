<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { useTabReturn } from '@/composables/useTabReturn'
import { useDraftsStore } from '@/stores/draftsStore'

/**
 * One draft open in two tabs stays one draft: a tab being left writes everything it holds at once,
 * and a tab being returned to reads back whatever another wrote since (AUTHORING.md, "Drafts").
 * Listened for here, once, rather than by each composer.
 */
const drafts = useDraftsStore()

function handleVisibility(): void {
  if (document.visibilityState === 'hidden') void drafts.flushAll()
}

function handleLeave(): void {
  void drafts.flushAll()
}

useTabReturn(() => void drafts.adoptChangesElsewhere())

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('pagehide', handleLeave)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('pagehide', handleLeave)
})
</script>

<template>
  <AppLayout>
    <RouterView />
  </AppLayout>
</template>
