<script setup lang="ts">
import AppLayout from '@/components/AppLayout.vue'
import { useTabCloseGuard, useTabLeave, useTabReturn } from '@/composables/useTabLifecycle'
import { useDraftsStore } from '@/stores/draftsStore'

// Listened for here, once, rather than by each composer. (AUTHORING.md, "Draft safety")
const drafts = useDraftsStore()

useTabLeave(() => void drafts.flushAll())
useTabReturn(() => void drafts.adoptChangesElsewhere())
useTabCloseGuard(() => Object.keys(drafts.writeFailed).length > 0)
</script>

<template>
  <AppLayout>
    <RouterView />
  </AppLayout>
</template>
