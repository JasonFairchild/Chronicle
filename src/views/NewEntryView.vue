<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import DraftElsewhereNotice from '@/components/DraftElsewhereNotice.vue'
import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { useSealDraft } from '@/composables/useSealDraft'
import { useDraftToResume } from '@/router/draftQuery'
import { toErrorMessage } from '@/utils/format'

/**
 * Where a new entry is written, and where the app opens. Its session opens at once, since the
 * editor needs one to report into; one never typed into writes nothing and is dropped on leaving.
 */
const session = useDraftSession()
const resumeError = ref<string | null>(null)

/** Reopens the linked draft, or starts afresh if it's gone. One that can't reopen shows read-only. */
async function reopen(id: string): Promise<void> {
  try {
    if (await session.resume(id)) return
  } catch (err) {
    resumeError.value = toErrorMessage(err, 'Failed to resume draft')
  }
  if (!session.readOnly) session.begin({ kind: 'new_root' })
}

const resumeDraftId = useDraftToResume().value
if (resumeDraftId) void reopen(resumeDraftId)
else session.begin({ kind: 'new_root' })

// Names the open draft in the URL so a reload reopens it.
const router = useRouter()
watch(
  () => session.sessionId,
  (id) => {
    if (id) void router.replace({ query: { draft: id } })
  },
  { immediate: true },
)

const handleSave = useSealDraft(session)

async function handleDiscard(): Promise<void> {
  await session.discard()
  session.begin({ kind: 'new_root' })
}

onBeforeUnmount(() => {
  void session.abandon()
})
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold tracking-tight">New entry</h1>

    <p v-if="resumeError" class="text-sm text-[var(--color-error)]" role="alert">
      {{ resumeError }}
    </p>

    <DraftElsewhereNotice :session="session" />

    <button
      v-if="!session.hasDraft && session.elsewhereNotice"
      type="button"
      class="btn-secondary px-3 py-1.5"
      @click="session.begin({ kind: 'new_root' })"
    >
      Start a new entry
    </button>

    <!-- Not before a resume lands, or what's typed meanwhile is lost. -->
    <EntryComposer
      v-if="session.hasDraft"
      :session="session"
      label="New entry"
      save-label="Save entry"
      @save="handleSave"
      @discard="handleDiscard"
    />
  </div>
</template>
