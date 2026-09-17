<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import DocumentEditor from '@/components/DocumentEditor.vue'
import EntryDatesFields from '@/components/EntryDatesFields.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { useEntriesStore } from '@/stores/entriesStore'
import type { AggregatedEntry } from '@/types/entry'
import { entryLabel, toErrorMessage } from '@/utils/format'

const props = defineProps<{
  /** The entry "Add connection" was clicked from — the edge's source (`parent_id`). */
  id: string
}>()

const router = useRouter()
const store = useEntriesStore()

const source = ref<AggregatedEntry | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)

/** Everything on the timeline except the source entry. Direction is fixed by which end you start from. */
const candidates = computed(() =>
  store.rootEntries
    .filter((entry) => entry.id !== props.id)
    .map((entry) => ({ id: entry.id, label: entryLabel(entry) })),
)

const targetId = ref('')
const session = useDraftSession()

const heading = computed(() =>
  source.value ? `New connection from “${entryLabel(source.value)}”` : 'New connection',
)

onMounted(async () => {
  loading.value = true
  error.value = null

  try {
    ;[source.value] = await Promise.all([
      store.getAggregatedEntry(props.id),
      store.loadRootEntries(),
    ])
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to load entry')
  } finally {
    loading.value = false
  }
})

/**
 * A connection structurally cannot exist without a destination (`target_id`), so the session only
 * begins once one is picked — the same gate "Create related entry" and "Revise entry" already put
 * in front of their own sessions before calling `begin`.
 */
function pickTarget(): void {
  if (!targetId.value || session.isOpen) return

  session.begin({ kind: 'new_connection', parent_id: props.id, target_id: targetId.value }, {})
}

async function save(): Promise<void> {
  actionError.value = null

  try {
    const saved = await session.save()
    if (saved) void router.push({ name: 'entry-detail', params: { id: props.id } })
  } catch (err) {
    actionError.value = toErrorMessage(err, 'Failed to add connection')
  }
}

async function discard(): Promise<void> {
  await session.discard()
  void router.push({ name: 'entry-detail', params: { id: props.id } })
}

onBeforeUnmount(() => {
  session.reset()
})
</script>

<template>
  <div class="space-y-6">
    <RouterLink
      :to="{ name: 'entry-detail', params: { id } }"
      class="inline-flex text-sm text-[var(--color-accent)] hover:underline"
    >
      ← Back to entry
    </RouterLink>

    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading entry...</div>

    <div v-else-if="error" class="text-sm text-[var(--color-error)]" role="alert">{{ error }}</div>

    <template v-else>
      <h1 class="text-xl font-semibold">{{ heading }}</h1>

      <p v-if="actionError" class="text-sm text-[var(--color-error)]" role="alert">
        {{ actionError }}
      </p>

      <p
        v-if="candidates.length === 0"
        class="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]"
      >
        There is nothing else to connect to yet. Write another entry first.
      </p>

      <template v-else>
        <label for="connection-target" class="block text-sm font-medium">Connect to</label>
        <select
          id="connection-target"
          v-model="targetId"
          class="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="session.isOpen"
          @change="pickTarget"
        >
          <option value="">Choose an entry</option>
          <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">
            {{ candidate.label }}
          </option>
        </select>

        <template v-if="session.isOpen">
          <EntryDatesFields
            :model-value="session.dates"
            :disabled="session.saving"
            @update:model-value="session.handleDatesChange"
          />

          <DocumentEditor
            label="New connection"
            with-title
            :title="session.title"
            :disabled="session.saving"
            @change="session.handleChange"
          />

          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-[var(--color-text-muted)]">
              Saved as a draft while you write. Nothing joins the timeline until you save it.
            </p>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
                :disabled="session.saving"
                @click="discard"
              >
                Discard
              </button>
              <button
                type="button"
                class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="session.saving || !session.canSave"
                @click="save"
              >
                Add connection
              </button>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
