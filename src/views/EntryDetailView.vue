<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import EntryDatesFields from '@/components/EntryDatesFields.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { useLayoutWidth } from '@/composables/useLayoutWidth'
import { useMedia } from '@/composables/useMedia'
import { docToPlainText, hasTitleNode } from '@/domain/entryDocument'
import type { AggregatedEntry, ResolvedAnchor } from '@/types/entry'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import { entryLabel, entryWhenLines, formatDate, toErrorMessage } from '@/utils/format'

const props = defineProps<{
  id: string
}>()

const router = useRouter()
const store = useEntriesStore()
const drafts = useDraftsStore()
const media = useMedia()
const loading = ref(true)
/** Set when the entry itself couldn't be fetched; exclusive with showing the article at all. */
const error = ref<string | null>(null)
/** Set when an action taken from an already-loaded entry fails; shown alongside its content. */
const actionError = ref<string | null>(null)
const mediaEl = ref<HTMLElement | null>(null)

// Holds an immutable snapshot, replaced wholesale and never mutated in place, so a shallow ref is
// the right tool. It also keeps Vue's reactive proxy off this data, which matters once it travels
// into the repository: a proxy is not structured-cloneable.
const aggregated = shallowRef<AggregatedEntry | null>(null)

/** The open revision session, if the entry's own text is being edited. `isOpen` false means it is being read. */
const revisionSession = useDraftSession()
/** Anchors this revision session has disturbed so far (PRODUCT.md §5.3). Sticky across the session. */
const revisionAffectedAnchorIds = ref<string[]>([])

/**
 * The open anchor-mode session, if a child entry is being composed against a passage. Mutually
 * exclusive with `revisionSession`: ENTRY_MODEL.md is explicit that the two creation experiences
 * are never offered in the same sitting, and hiding each control while the other is open is what
 * enforces that in the UI rather than merely documenting it.
 *
 * `useDraftSession` covers the child's own prose (`childSession.content`); the parent gaining
 * provisional anchors is a second document `useDraftSession` doesn't know about, tracked here
 * alongside it and pushed into the same underlying draft via `recordParentChange`.
 */
const childSession = useDraftSession()
const childParentContent = ref('')

/** Two columns of readable width need more room than the page gives by default. */
const layoutWidth = useLayoutWidth()

const heading = computed(() => aggregated.value?.title ?? 'Entry detail')

/** The user's own dates, one line each. Empty when they gave none, so nothing is shown. */
const whenLines = computed(() => (aggregated.value ? entryWhenLines(aggregated.value.dates) : []))

const versionLabel = computed(() => {
  const version = aggregated.value?.version
  if (!version || version.total <= 1) return null
  return `Version ${version.index} of ${version.total}`
})

/** Whether the document being read has a title node, so an anchor-mode editor opens the same shape. */
const parentHasTitle = computed(() => hasTitleNode(aggregated.value?.content ?? ''))

/**
 * The note each disturbed anchor belongs to, named rather than just counted (PRODUCT.md §5.3: "say
 * so before saving, and name the note"). Anchors, not children, are what a revision can disturb, so
 * this reads them off every child's resolved anchor list rather than the children themselves.
 */
const revisionWarnings = computed<string[]>(() => {
  if (revisionAffectedAnchorIds.value.length === 0) return []

  const owners = new Map<string, string>()
  for (const child of aggregated.value?.children ?? []) {
    for (const anchor of child.anchors) {
      owners.set(anchor.anchor_id, entryLabel(child.entry))
    }
  }

  const names = revisionAffectedAnchorIds.value.map((id) => owners.get(id) ?? 'a note')
  return [...new Set(names)]
})

async function loadEntry(entryId: string): Promise<void> {
  loading.value = true
  error.value = null

  try {
    aggregated.value = await store.getAggregatedEntry(entryId)
  } catch (err) {
    // A failed fetch means there is no confirmed data for this id, so any previously-loaded
    // entry (from before navigating here) is cleared rather than left on screen under a
    // mismatched id.
    aggregated.value = null
    error.value = toErrorMessage(err, 'Failed to load entry')
  } finally {
    loading.value = false
  }
}

/** Discards an in-progress revision rather than leaving it open. */
function resetRevisionState(): void {
  revisionSession.reset()
  revisionAffectedAnchorIds.value = []
}

/** Discards an in-progress anchor-mode session rather than leaving it open. */
function resetChildState(): void {
  childSession.reset()
  childParentContent.value = ''
}

onMounted(() => {
  void loadEntry(props.id)
})

watch(
  () => props.id,
  (entryId) => {
    // Otherwise saving after navigating away would seal against whichever entry this session's
    // draft still points at, not the one now on screen.
    resetRevisionState()
    resetChildState()
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

// Raised only while the side-by-side session is open, and lowered again however it ends — saved,
// discarded, or navigated away from.
watch(
  () => childSession.isOpen,
  (open) => {
    layoutWidth.value = open ? 'wide' : 'normal'
  },
)

onBeforeUnmount(() => {
  layoutWidth.value = 'normal'
})

/** Connections get the full entry model (title, dates, rich content), so they're a whole screen. */
function goToNewConnection(): void {
  void router.push({ name: 'new-connection', params: { id: props.id } })
}

/**
 * Opening an entry to revise it produces a pending revision draft, leaving the entry untouched
 * until it is sealed. The editor seeds from the current aggregate state rather than the stored
 * row, or an entry that has already been revised would reopen at its first version.
 */
function startRevising(): void {
  const current = aggregated.value
  if (!current) return

  revisionSession.begin({ kind: 'revision', parent_id: props.id }, { content: current.content })
}

function handleRevisionChange(change: EditorChange): void {
  revisionAffectedAnchorIds.value = change.affectedAnchorIds ?? []
  revisionSession.handleChange(change)
}

async function saveRevision(): Promise<void> {
  actionError.value = null

  try {
    const saved = await revisionSession.save()
    if (saved) await loadEntry(props.id)
  } catch (err) {
    actionError.value = toErrorMessage(err, 'Failed to save revision')
  }
}

async function cancelRevision(): Promise<void> {
  await revisionSession.discard()
}

/**
 * Opens an anchor-mode session: two documents, the parent gaining provisional anchors and the
 * child's own prose, sealing atomically together (ENTRY_MODEL.md, "Drafts").
 *
 * Anchoring is optional within it. Marking nothing and simply writing produces a note about the
 * entry at large, which is why there is one way in here rather than a separate form for that case.
 */
function startRelatedEntry(): void {
  const current = aggregated.value
  if (!current) return

  childParentContent.value = current.content
  childSession.begin({ kind: 'new_child', parent_id: props.id }, { parentContent: current.content })
}

/** The parent's own document, tracked outside `childSession` — see its declaration above. */
function handleParentAnchorChange(change: EditorChange): void {
  if (!childSession.sessionId) return

  childParentContent.value = change.content
  drafts.recordParentChange(childSession.sessionId, {
    content: change.content,
    steps: change.steps,
    anchorIds: change.anchorIds ?? [],
  })
}

async function saveChildEntry(): Promise<void> {
  actionError.value = null

  try {
    const saved = await childSession.save()
    if (saved) await loadEntry(props.id)
  } catch (err) {
    actionError.value = toErrorMessage(err, 'Failed to add entry')
  }
}

async function cancelChildEntry(): Promise<void> {
  await childSession.discard()
}

/**
 * One line per anchor. A strike and its replacement wording are one anchor sharing one id, not two
 * things to guess into a pair, so there is exactly one case for a strike whether or not it carries
 * replacement wording. An orphaned anchor keeps the wording it covered, so a revision that breaks a
 * reference reads as history rather than disappearing.
 */
function describeAnchor(resolved: ResolvedAnchor): string {
  if (resolved.status === 'orphaned') {
    return resolved.quote
      ? `Was attached to: “${resolved.quote}”`
      : 'Was attached to a removed passage'
  }

  if (resolved.kind === 'strike') {
    const where = resolved.quote ? `“${resolved.quote}”` : 'a point in the text'
    return resolved.insertion
      ? `Strikes ${where}, replaced with “${resolved.insertion}”`
      : `Strikes ${where}`
  }

  if (resolved.kind === 'comment') {
    return resolved.quote ? `On “${resolved.quote}”` : 'On a point in the text'
  }

  // No mark at all: a bare insertion with nothing struck.
  return resolved.insertion ? `Adds “${resolved.insertion}”` : 'On a point in the text'
}
</script>

<template>
  <div class="space-y-6">
    <RouterLink to="/" class="inline-flex text-sm text-[var(--color-accent)] hover:underline">
      ← Back to timeline
    </RouterLink>

    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading entry...</div>

    <div v-else-if="error" class="text-sm text-[var(--color-error)]" role="alert">{{ error }}</div>

    <div v-else-if="!aggregated" class="text-sm text-[var(--color-text-muted)]">
      Entry not found.
    </div>

    <template v-else>
      <p v-if="actionError" class="text-sm text-[var(--color-error)]" role="alert">
        {{ actionError }}
      </p>

      <article class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header
          class="mb-4 flex items-start justify-between gap-4 border-b border-[var(--color-border)] pb-4"
        >
          <div>
            <h1 class="text-xl font-semibold">{{ heading }}</h1>
            <p v-for="line in whenLines" :key="line" class="mt-1 text-sm">{{ line }}</p>
            <p class="mt-1 text-sm text-[var(--color-text-muted)]">
              Created {{ formatDate(aggregated.created_at, 'full') }}
              <span v-if="versionLabel"> · {{ versionLabel }}</span>
            </p>
          </div>

          <div
            v-if="!revisionSession.isOpen && !childSession.isOpen"
            class="flex shrink-0 flex-wrap justify-end gap-2"
          >
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              @click="startRelatedEntry"
            >
              Create related entry
            </button>
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              @click="startRevising"
            >
              Revise entry
            </button>
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              @click="goToNewConnection"
            >
              Add connection
            </button>
          </div>
        </header>

        <template v-if="revisionSession.isOpen">
          <p class="mb-2 text-sm text-[var(--color-text-muted)]">
            Editing appends a new version. The current text stays in the entry's history either way.
          </p>

          <DocumentEditor
            label="Revised entry"
            with-title
            :content="revisionSession.content"
            :disabled="revisionSession.saving"
            @change="handleRevisionChange"
          />

          <p
            v-if="revisionWarnings.length > 0"
            class="mt-2 text-sm text-[var(--color-accent)]"
            role="status"
          >
            This changes the passage {{ revisionWarnings.join(', ') }}
            {{ revisionWarnings.length === 1 ? 'is' : 'are' }} about.
          </p>

          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
              :disabled="revisionSession.saving"
              @click="cancelRevision"
            >
              Discard revision
            </button>
            <button
              type="button"
              class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="revisionSession.saving"
              @click="saveRevision"
            >
              Save revision
            </button>
          </div>
        </template>

        <template v-else-if="childSession.isOpen">
          <div class="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 class="mb-2 text-sm font-medium">This entry</h2>
              <p class="mb-2 text-sm text-[var(--color-text-muted)]">
                Select a passage and mark it, or place the cursor and propose wording. Surrounding
                text cannot be changed from here.
              </p>

              <DocumentEditor
                label="Entry being annotated"
                anchor-mode
                :with-title="parentHasTitle"
                :content="childParentContent"
                :disabled="childSession.saving"
                @change="handleParentAnchorChange"
              />
            </section>

            <section>
              <h2 class="mb-2 text-sm font-medium">The related entry</h2>
              <p class="mb-2 text-sm text-[var(--color-text-muted)]">
                Marking a passage is optional — with nothing marked this becomes a note about the
                entry as a whole.
              </p>

              <EntryDatesFields
                :model-value="childSession.dates"
                :disabled="childSession.saving"
                @update:model-value="childSession.handleDatesChange"
              />

              <DocumentEditor
                label="Your note"
                :content="childSession.content"
                :disabled="childSession.saving"
                @change="childSession.handleChange"
              />

              <div class="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
                  :disabled="childSession.saving"
                  @click="cancelChildEntry"
                >
                  Discard
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="childSession.saving || !childSession.content.trim()"
                  @click="saveChildEntry"
                >
                  Add entry
                </button>
              </div>
            </section>
          </div>
        </template>

        <template v-else>
          <DocumentEditor
            label="Entry content"
            :with-title="parentHasTitle"
            :content="aggregated.content"
            disabled
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

            <p
              v-for="line in entryWhenLines(child.entry.dates)"
              :key="line"
              class="mt-1 text-xs text-[var(--color-text-muted)]"
            >
              {{ line }}
            </p>

            <ul v-if="child.anchors.length > 0" class="mt-2 space-y-1">
              <li
                v-for="resolved in child.anchors"
                :key="resolved.anchor_id"
                class="text-xs text-[var(--color-text-muted)]"
                :class="{ italic: resolved.status === 'orphaned' }"
              >
                {{ describeAnchor(resolved) }}
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
              {{ entryLabel(connection.entry) }}
            </RouterLink>
            <!--
              Only when there's a real title: otherwise `entryLabel` above already used the content
              preview as the link text, and repeating it here would just say the same thing twice.
            -->
            <span v-if="connection.entry.title && docToPlainText(connection.entry.content)">
              · {{ docToPlainText(connection.entry.content) }}
            </span>
          </p>
        </section>
      </article>
    </template>
  </div>
</template>
