<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import ChildEntryForm, { type ChildEntrySubmission } from '@/components/ChildEntryForm.vue'
import ConnectionForm, {
  type ConnectionCandidate,
  type ConnectionSubmission,
} from '@/components/ConnectionForm.vue'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { useMedia } from '@/composables/useMedia'
import { docToPlainText } from '@/domain/entryDocument'
import { createDocLocation } from '@/domain/resolveAnchor'
import type { AggregatedEntry, AnchorOp, DocLocation, ResolvedOp } from '@/types/entry'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'

const props = defineProps<{
  id: string
}>()

const store = useEntriesStore()
const drafts = useDraftsStore()
const media = useMedia()
const loading = ref(true)
/** Set when the entry itself couldn't be fetched; exclusive with showing the article at all. */
const error = ref<string | null>(null)
/** Set when an action taken from an already-loaded entry fails; shown alongside its content. */
const actionError = ref<string | null>(null)
const contentEl = ref<HTMLElement | null>(null)
const mediaEl = ref<HTMLElement | null>(null)

/**
 * Both of these hold immutable snapshots that are replaced wholesale, never mutated in place, so
 * a shallow ref is the right tool. It also keeps Vue's reactive proxy off this data: a proxy is
 * not structured-cloneable, and anchors built from it travel down into the repository.
 */
const aggregated = shallowRef<AggregatedEntry | null>(null)
const selection = shallowRef<DocLocation | null>(null)

/** The open revision session, if the entry is being edited. Null means it is being read. */
const revisionSession = ref<string | null>(null)
const revisionContent = ref('')
const savingRevision = ref(false)

const heading = computed(() => aggregated.value?.title ?? 'Entry detail')

/**
 * The one rendering of the document, and the exact string anchors are measured against. Rendering
 * anything else here — the serialized JSON, or a differently flattened copy — would put selection
 * offsets and stored anchors on different rulers.
 */
const plainText = computed(() => docToPlainText(aggregated.value?.content ?? ''))

const versionLabel = computed(() => {
  const version = aggregated.value?.version
  if (!version || version.total <= 1) return null
  return `Version ${version.index} of ${version.total}`
})

/** Everything on the timeline except this entry. Direction is chosen by which end you start from. */
const connectionCandidates = computed<ConnectionCandidate[]>(() =>
  store.rootEntries
    .filter((entry) => entry.id !== props.id)
    .map((entry) => ({
      id: entry.id,
      label: entry.title ?? preview(docToPlainText(entry.content)),
    })),
)

async function loadEntry(entryId: string): Promise<void> {
  loading.value = true
  error.value = null
  selection.value = null

  try {
    aggregated.value = await store.getAggregatedEntry(entryId)
  } catch (err) {
    // A failed fetch means there is no confirmed data for this id, so any previously-loaded
    // entry (from before navigating here) is cleared rather than left on screen under a
    // mismatched id.
    aggregated.value = null
    error.value = err instanceof Error ? err.message : 'Failed to load entry'
  } finally {
    loading.value = false
  }
}

/**
 * Discards an in-progress revision rather than leaving it open. Only called when navigating to a
 * different entry — never from a same-entry refresh, since a revision can be open while the
 * always-visible add-child/add-connection forms below are used, and refreshing after one of those
 * must not discard unrelated in-progress work.
 */
function resetRevisionState(): void {
  if (revisionSession.value) {
    void drafts.discardDraft(revisionSession.value)
  }
  revisionSession.value = null
  revisionContent.value = ''
  savingRevision.value = false
}

onMounted(() => {
  void loadEntry(props.id)
  // The connection picker needs something to pick from, and the timeline roots are that list.
  void store.loadRootEntries()
})

watch(
  () => props.id,
  (entryId) => {
    // Otherwise "Save revision" after navigating away would seal against whichever entry this
    // session's draft still points at, not the one now on screen.
    resetRevisionState()
    void loadEntry(entryId)
  },
)

// `post` because this reaches into the rendered <img> elements: running before the DOM updates
// would resolve the previous entry's attachments, or none at all on first load.
watch(
  () => aggregated.value?.media_refs,
  () => {
    void media.applyTo(mediaEl.value)
  },
  { flush: 'post' },
)

/**
 * Converts a DOM selection into an offset in the entry's text.
 *
 * Measuring with a range from the container's start is robust to the text being split across
 * nodes, which is what happens as soon as the content stops being one flat string.
 */
function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(container)
  range.setEnd(node, offset)
  return range.toString().length
}

function captureSelection(): void {
  const domSelection = window.getSelection()
  const container = contentEl.value
  const current = aggregated.value

  if (!domSelection || !container || !current || domSelection.isCollapsed) {
    selection.value = null
    return
  }

  const range = domSelection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    selection.value = null
    return
  }

  selection.value = createDocLocation(
    plainText.value,
    offsetWithin(container, range.startContainer, range.startOffset),
    offsetWithin(container, range.endContainer, range.endOffset),
    current.version.revision_id,
  )
}

/**
 * A strike with replacement wording becomes two ops in one child entry, which is the replacement
 * gesture. Nothing is hidden: the original stays and the new wording sits beside it.
 */
function buildAnchors(submission: ChildEntrySubmission, at: DocLocation | null): AnchorOp[] {
  if (!at) return []

  if (submission.opKind !== 'strike') {
    return [{ kind: 'comment', at }]
  }

  const ops: AnchorOp[] = [{ kind: 'strike', at }]
  if (submission.insertion) {
    ops.push({
      kind: 'insert',
      at: createDocLocation(plainText.value, at.to, at.to, at.base_version_id),
      text: submission.insertion,
    })
  }

  return ops
}

async function handleAddChild(submission: ChildEntrySubmission): Promise<void> {
  actionError.value = null

  try {
    await store.createChildEntry({
      parentId: props.id,
      relationType: submission.relationType,
      content: submission.content,
      anchors: buildAnchors(submission, selection.value),
    })
    await loadEntry(props.id)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to add entry'
  }
}

async function handleAddConnection(submission: ConnectionSubmission): Promise<void> {
  actionError.value = null

  try {
    await store.createConnection({
      fromId: props.id,
      toId: submission.toId,
      content: submission.content,
      label: submission.label,
    })
    await loadEntry(props.id)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to add connection'
  }
}

/**
 * Opening an entry to revise it produces a pending revision draft, leaving the entry untouched
 * until it is sealed. The editor seeds from the current aggregate state rather than the stored
 * row, or an entry that has already been revised would reopen at its first version.
 */
function startRevising(): void {
  const current = aggregated.value
  if (!current) return

  revisionContent.value = current.content
  revisionSession.value = drafts.beginDraft(
    { kind: 'revision', parent_id: props.id },
    { content: current.content },
  )
}

function handleRevisionChange(change: EditorChange): void {
  if (!revisionSession.value) return

  revisionContent.value = change.content
  drafts.recordChange(revisionSession.value, change)
}

async function saveRevision(): Promise<void> {
  const sessionId = revisionSession.value
  if (!sessionId || savingRevision.value) return

  savingRevision.value = true
  actionError.value = null

  try {
    await drafts.sealDraft(sessionId)
    revisionSession.value = null
    await loadEntry(props.id)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : 'Failed to save revision'
  } finally {
    savingRevision.value = false
  }
}

async function cancelRevision(): Promise<void> {
  const sessionId = revisionSession.value
  if (!sessionId) return

  revisionSession.value = null
  await drafts.discardDraft(sessionId)
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function preview(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 60 ? `${singleLine.slice(0, 57)}...` : singleLine || 'Untitled entry'
}

/**
 * An orphaned anchor keeps the wording it was attached to, so an edit that breaks a reference
 * reads as history rather than disappearing.
 */
function describeOp(resolved: ResolvedOp): string {
  const { op, status } = resolved

  if (op.kind === 'media') {
    return status === 'orphaned' ? 'Referred to a removed attachment' : 'On an attachment'
  }

  const quote = op.at.quote
  if (status === 'orphaned') {
    return quote ? `Was attached to: “${quote}”` : 'Was attached to a removed passage'
  }

  if (op.kind === 'insert') {
    return `Adds “${op.text}”`
  }

  const where = quote ? `“${quote}”` : 'a point in the text'
  return op.kind === 'strike' ? `Strikes ${where}` : `On ${where}`
}
</script>

<template>
  <div class="space-y-6">
    <RouterLink to="/" class="inline-flex text-sm text-[var(--color-accent)] hover:underline">
      ← Back to timeline
    </RouterLink>

    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading entry...</div>

    <div v-else-if="error" class="text-sm text-red-500" role="alert">{{ error }}</div>

    <div v-else-if="!aggregated" class="text-sm text-[var(--color-text-muted)]">
      Entry not found.
    </div>

    <template v-else>
      <p v-if="actionError" class="text-sm text-red-500" role="alert">{{ actionError }}</p>

      <article class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header
          class="mb-4 flex items-start justify-between gap-4 border-b border-[var(--color-border)] pb-4"
        >
          <div>
            <h1 class="text-xl font-semibold">{{ heading }}</h1>
            <p class="mt-1 text-sm text-[var(--color-text-muted)]">
              Created {{ formatDate(aggregated.created_at) }}
              <span v-if="versionLabel"> · {{ versionLabel }}</span>
            </p>
          </div>

          <button
            v-if="!revisionSession"
            type="button"
            class="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            @click="startRevising"
          >
            Revise
          </button>
        </header>

        <template v-if="revisionSession">
          <p class="mb-2 text-sm text-[var(--color-text-muted)]">
            Editing appends a new version. The current text stays in the entry's history either way.
          </p>

          <DocumentEditor
            label="Revised entry"
            with-title
            :content="revisionContent"
            :disabled="savingRevision"
            @change="handleRevisionChange"
          />

          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
              :disabled="savingRevision"
              @click="cancelRevision"
            >
              Discard revision
            </button>
            <button
              type="button"
              class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="savingRevision"
              @click="saveRevision"
            >
              Save revision
            </button>
          </div>
        </template>

        <template v-else>
          <!--
            v-text rather than interpolation: it guarantees this element's text is exactly the
            canonical flattening in a single node, so selection offsets map straight onto string
            indices instead of picking up template whitespace.
          -->
          <div
            ref="contentEl"
            data-testid="entry-content"
            class="whitespace-pre-wrap text-sm leading-relaxed"
            @mouseup="captureSelection"
            @keyup="captureSelection"
            v-text="plainText"
          />

          <section v-if="aggregated.media_refs.length > 0" ref="mediaEl" class="mt-4 space-y-2">
            <h2
              class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
            >
              Attachments
            </h2>
            <ul class="flex flex-wrap gap-3">
              <li v-for="mediaRef in aggregated.media_refs" :key="mediaRef">
                <!-- src is filled in from an object URL; the document only ever stores the id. -->
                <img
                  :data-media-ref="mediaRef"
                  alt="Attached image"
                  class="max-h-40 rounded-lg border border-[var(--color-border)]"
                />
              </li>
            </ul>
          </section>
        </template>

        <section v-if="aggregated.children.length > 0" class="mt-6 space-y-3">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Related entries
          </h2>

          <article
            v-for="child in aggregated.children"
            :key="child.entry.id"
            class="rounded-lg border border-[var(--color-border)] p-3"
          >
            <div class="mb-1 flex items-center gap-2">
              <span class="text-xs uppercase tracking-wide text-[var(--color-accent)]">
                {{ child.relation_type }}
              </span>
              <span v-if="child.has_children" class="text-xs text-[var(--color-text-muted)]">
                has related entries
              </span>
            </div>

            <p class="whitespace-pre-wrap text-sm leading-relaxed">
              {{ docToPlainText(child.entry.content) }}
            </p>

            <ul v-if="child.ops.length > 0" class="mt-2 space-y-1">
              <li
                v-for="(resolved, opIndex) in child.ops"
                :key="opIndex"
                class="text-xs text-[var(--color-text-muted)]"
                :class="{ italic: resolved.status === 'orphaned' }"
              >
                {{ describeOp(resolved) }}
              </li>
            </ul>
          </article>
        </section>

        <section v-if="aggregated.connections.length > 0" class="mt-6 space-y-2">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Connections
          </h2>

          <p
            v-for="connection in aggregated.connections"
            :key="connection.entry.id"
            class="text-sm text-[var(--color-text-muted)]"
          >
            <span aria-hidden="true">{{ connection.direction === 'outgoing' ? '→' : '←' }}</span>
            <RouterLink
              :to="{ name: 'entry-detail', params: { id: connection.other_id } }"
              class="text-[var(--color-accent)] hover:underline"
            >
              {{ connection.label ?? 'related to' }}
            </RouterLink>
            <span v-if="connection.entry.content">
              · {{ docToPlainText(connection.entry.content) }}
            </span>
          </p>
        </section>
      </article>

      <section>
        <h2 class="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Add a related entry
        </h2>
        <ChildEntryForm :quote="selection?.quote ?? null" @submit="handleAddChild" />
      </section>

      <section>
        <h2 class="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Connect to another entry
        </h2>
        <ConnectionForm :candidates="connectionCandidates" @submit="handleAddConnection" />
      </section>
    </template>
  </div>
</template>
