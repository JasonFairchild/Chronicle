<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { previewText } from '@/domain/entryDocument'
import { draftLocation } from '@/router/draftQuery'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import type { DraftSnapshot } from '@/types/draft'
import { entryLabel, formatDate, toErrorMessage } from '@/utils/format'

/**
 * Every unsealed draft, each linked to the page it was started from, where it reopens just as it
 * would from there. Discarding is the one thing done here.
 */

/** A draft's own text is shown at full width here, so it gets more room than a picker label would. */
const PREVIEW_LIMIT = 120

const drafts = useDraftsStore()
const store = useEntriesStore()

const error = ref<string | null>(null)

/** What each draft is attached to, so the list can name it rather than just describe its kind. */
const parentLabels = ref<Record<string, string>>({})

async function refresh(): Promise<void> {
  error.value = null

  try {
    await drafts.loadDrafts()
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to load drafts')
  }
}

onMounted(() => {
  void refresh()
})

function parentIdOf(draft: DraftSnapshot): string | null {
  return draft.kind === 'new_root' ? null : draft.parent_id
}

async function loadParentLabels(list: DraftSnapshot[]): Promise<void> {
  const parentIds = [...new Set(list.map(parentIdOf))].filter((id): id is string => id !== null)

  // Aggregated, not the stored row: a revision may have renamed the entry since.
  const parents = await Promise.all(parentIds.map((id) => store.getAggregatedEntry(id)))

  const labels: Record<string, string> = {}
  parents.forEach((parent, index) => {
    if (!parent) return
    labels[parentIds[index]!] = entryLabel(parent)
  })

  parentLabels.value = labels
}

// Whatever reloaded the list — this page, a discard, a return to the tab — its names follow.
watch(
  () => drafts.drafts,
  (list) => {
    loadParentLabels(list).catch((err) => {
      error.value = toErrorMessage(err, 'Failed to load drafts')
    })
  },
  { immediate: true },
)

/** A drafts list exists so nothing is stranded, which means saying what each one would become. */
function describe(draft: DraftSnapshot): string {
  if (draft.kind === 'new_root') return 'New entry'

  const parent = parentLabels.value[draft.parent_id] ?? 'another entry'

  if (draft.kind === 'revision') return `Revision of “${parent}”`
  if (draft.kind === 'new_connection') return `Connection from “${parent}”`
  // Not "annotation" or "update": which one it reads as follows from what gets anchored, and an
  // unsealed draft has not settled that yet.
  return `Related entry on “${parent}”`
}

async function discard(sessionId: string): Promise<void> {
  error.value = null

  try {
    await drafts.discardDraft(sessionId)
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to discard draft')
  }
}
</script>

<template>
  <div class="space-y-6">
    <section>
      <h1 class="mb-2 text-2xl font-semibold tracking-tight">Drafts</h1>
      <p class="text-sm text-[var(--color-text-muted)]">
        Unsealed writing sessions. They are saved as you type and stay out of every timeline until
        you save one as an entry.
      </p>
    </section>

    <p v-if="error" class="text-sm text-[var(--color-error)]" role="alert">{{ error }}</p>

    <p
      v-if="drafts.drafts.length === 0"
      class="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]"
    >
      No drafts in progress.
    </p>

    <ul v-else class="space-y-3">
      <li
        v-for="draft in drafts.drafts"
        :key="draft.session_id"
        class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      >
        <div class="mb-2 flex items-center justify-between gap-3">
          <span class="text-xs uppercase tracking-wide text-[var(--color-accent)]">
            {{ describe(draft) }}
          </span>
          <time class="text-xs text-[var(--color-text-muted)]" :datetime="draft.updated_at">
            {{ formatDate(draft.updated_at) }}
          </time>
        </div>

        <p class="whitespace-pre-wrap text-sm leading-relaxed">
          {{ previewText(draft.entry.content, PREVIEW_LIMIT) }}
        </p>

        <div class="mt-3 flex justify-end gap-2">
          <button
            type="button"
            class="btn-secondary px-3 py-1.5"
            @click="discard(draft.session_id)"
          >
            Discard
          </button>
          <RouterLink :to="draftLocation(draft)" class="btn-primary px-3 py-1.5">
            Resume
          </RouterLink>
        </div>
      </li>
    </ul>
  </div>
</template>
