<script setup lang="ts">
import AppLayout from '@/components/AppLayout.vue'
import { useTabLeave, useTabReturn } from '@/composables/useTabVisibility'
import { useDraftsStore } from '@/stores/draftsStore'

/**
 * One draft open in two tabs stays one draft: a tab being left writes everything it holds at once,
 * and a tab being returned to reads back whatever another wrote since (AUTHORING.md, "Draft safety").
 * Listened for here, once, rather than by each composer.
 */
const drafts = useDraftsStore()

useTabLeave(() => void drafts.flushAll())
useTabReturn(() => void drafts.adoptChangesElsewhere())
</script>

<template>
  <AppLayout>
    <RouterView />
  </AppLayout>
</template>
