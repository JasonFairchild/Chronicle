<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DocumentEditor from '@/components/DocumentEditor.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { isEmptyDocument, previewText } from '@/domain/entryDocument'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import type { Draft, DraftTarget } from '@/types/draft'
import { formatDate, toErrorMessage } from '@/utils/format'

/** A draft's own text is shown at full width here, so it gets more room than a picker label would. */
const PREVIEW_LIMIT = 120

const drafts = useDraftsStore()
const store = useEntriesStore()

const session = useDraftSession()
const error = ref<string | null>(null)

/** What each draft is attached to, so the list can name it rather than just describe its kind. */
const parentLabels = ref<Record<string, string>>({})

onMounted(() => {
  void refresh()
})

async function refresh(): Promise<void> {
  error.value = null

  try {
    await drafts.loadDrafts()
    await loadParentLabels()
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to load drafts')
  }
}

async function loadParentLabels(): Promise<void> {
  const parentIds = [...new Set(drafts.drafts.map((draft) => parentIdOf(draft.target)))].filter(
    (id): id is string => id !== null,
  )

  const parents = await Promise.all(parentIds.map((id) => store.getEntry(id)))

  const labels: Record<string, string> = {}
  parents.forEach((parent, index) => {
    if (!parent) return
    labels[parentIds[index]!] = parent.title ?? previewText(parent.content, PREVIEW_LIMIT)
  })

  parentLabels.value = labels
}

function parentIdOf(target: DraftTarget): string | null {
  return target.kind === 'new_root' ? null : target.parent_id
}

/** A drafts list exists so nothing is stranded, which means saying what each one would become. */
function describe(draft: Draft): string {
  const { target } = draft
  if (target.kind === 'new_root') return 'New entry'

  const parent = parentLabels.value[target.parent_id] ?? 'another entry'
  return target.kind === 'revision'
    ? `Revision of “${parent}”`
    : `${labelFor(target)} on “${parent}”`
}

function labelFor(target: Extract<DraftTarget, { kind: 'new_child' }>): string {
  return target.relation_type === 'update' ? 'Update' : 'Annotation'
}

async function resume(draft: Draft): Promise<void> {
  error.value = null

  // Reopening rebuilds the authoring session from what was flushed, so the step chain continues
  // rather than restarting at the reload. This has to finish before the editor mounts — otherwise
  // typing right after clicking "Resume" could record into a session that isn't open yet.
  await session.resume(draft.session_id)
}

async function seal(): Promise<void> {
  if (isEmptyDocument(session.content)) return

  error.value = null

  try {
    const saved = await session.save()
    if (saved) await refresh()
  } catch (err) {
    error.value = toErrorMessage(err, 'Failed to save entry')
  }
}

/**
 * Discards any draft in the list, not only the one open for editing — every row offers this, so
 * the session composable (which only ever tracks the one currently open) is used when this is
 * that draft, and the store directly otherwise.
 */
async function discard(sessionId: string): Promise<void> {
  error.value = null

  try {
    if (session.sessionId === sessionId) {
      await session.discard()
    } else {
      await drafts.discardDraft(sessionId)
    }
    await refresh()
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

        <template v-if="session.sessionId === draft.session_id">
          <DocumentEditor
            label="Draft"
            :content="session.content"
            :with-title="draft.target.kind !== 'new_child'"
            :disabled="session.saving"
            @change="session.handleChange"
          />

          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
              @click="discard(draft.session_id)"
            >
              Discard
            </button>
            <button
              type="button"
              class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="session.saving"
              @click="seal"
            >
              Save as entry
            </button>
          </div>
        </template>

        <template v-else>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">
            {{ previewText(draft.content, PREVIEW_LIMIT) }}
          </p>

          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)]"
              @click="discard(draft.session_id)"
            >
              Discard
            </button>
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              @click="resume(draft)"
            >
              Resume
            </button>
          </div>
        </template>
      </li>
    </ul>
  </div>
</template>
