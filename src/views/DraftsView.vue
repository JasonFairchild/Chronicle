<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { docToPlainText, isEmptyDocument } from '@/domain/entryDocument'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import type { Draft, DraftTarget } from '@/types/draft'

const drafts = useDraftsStore()
const store = useEntriesStore()

const openSession = ref<string | null>(null)
const openContent = ref('')
const saving = ref(false)
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
    error.value = err instanceof Error ? err.message : 'Failed to load drafts'
  }
}

async function loadParentLabels(): Promise<void> {
  const parentIds = [...new Set(drafts.drafts.map((draft) => parentIdOf(draft.target)))].filter(
    (id): id is string => id !== null,
  )

  const parents = await Promise.all(parentIds.map((id) => store.getEntry(id)))

  const labels: Record<string, string> = {}
  parents.forEach((parent, index) => {
    if (parent) labels[parentIds[index]!] = parent.title ?? preview(docToPlainText(parent.content))
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
  const resumed = await drafts.resumeDraft(draft.session_id)
  if (!resumed) return

  openContent.value = resumed.content
  openSession.value = draft.session_id
}

function handleChange(change: EditorChange): void {
  if (!openSession.value) return

  openContent.value = change.content
  drafts.recordChange(openSession.value, change)
}

async function seal(): Promise<void> {
  const sessionId = openSession.value
  if (!sessionId || saving.value || isEmptyDocument(openContent.value)) return

  saving.value = true
  error.value = null

  try {
    await drafts.sealDraft(sessionId)
    openSession.value = null
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save entry'
  } finally {
    saving.value = false
  }
}

async function discard(sessionId: string): Promise<void> {
  error.value = null

  try {
    await drafts.discardDraft(sessionId)
    if (openSession.value === sessionId) openSession.value = null
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to discard draft'
  }
}

function preview(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
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

    <p v-if="error" class="text-sm text-red-500" role="alert">{{ error }}</p>

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

        <template v-if="openSession === draft.session_id">
          <DocumentEditor
            label="Draft"
            :content="draft.content"
            :with-title="draft.target.kind !== 'new_child'"
            :disabled="saving"
            @change="handleChange"
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
              :disabled="saving"
              @click="seal"
            >
              Save as entry
            </button>
          </div>
        </template>

        <template v-else>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">
            {{ preview(docToPlainText(draft.content)) }}
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
