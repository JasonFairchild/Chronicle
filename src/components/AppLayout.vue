<script setup lang="ts">
import { RouterLink } from 'vue-router'
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

    <main class="mx-auto max-w-3xl px-4 py-8">
      <slot />
    </main>
  </div>
</template>
