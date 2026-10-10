<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import DraftElsewhereNotice from '@/components/DraftElsewhereNotice.vue'
import EntryCard from '@/components/EntryCard.vue'
import EntryComposer from '@/components/EntryComposer.vue'
import RelatedEntryComposer from '@/components/RelatedEntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { useLayoutWidth } from '@/composables/useLayoutWidth'
import { useMedia } from '@/composables/useMedia'
import { useSealDraft } from '@/composables/useSealDraft'
import { useTabReturn } from '@/composables/useTabReturn'
import { currentVersionId } from '@/domain/reconstructEntryState'
import { versionsRevisedBy, type DraftSnapshot } from '@/types/draft'
import type { AggregatedEntry, ResolvedAnchor } from '@/types/entry'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import {
  entryDetailLines,
  entryLabel,
  formatDateline,
  formatTime,
  toErrorMessage,
} from '@/utils/format'

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

/**
 * What this entry is about, if it's not a root: the parent it annotates/updates, or the two
 * endpoints it connects. `AggregatedEntry` only carries ids for these, so their labels are a
 * second, small fetch alongside the entry itself.
 */
const breadcrumbEntries = shallowRef<{ id: string; label: string }[]>([])

const breadcrumbKind = computed<'about' | 'connects' | null>(() => {
  const relation = aggregated.value?.relation_type
  if (relation === 'annotation' || relation === 'update') return 'about'
  if (relation === 'connection') return 'connects'
  return null
})

/** The open revision session, if the entry's own text is being edited. `isOpen` false means it is being read. */
const revisionSession = useDraftSession()
/** Anchors this revision session has disturbed so far (PRODUCT.md §4.5). Sticky across the session. */
const revisionAffectedAnchorIds = ref<string[]>([])

/**
 * The open anchor-mode session, if a related entry is being composed against a passage. Mutually
 * exclusive with `revisionSession` (ENTRY_MODEL.md, "Two creation experiences, kept separate"):
 * hiding each control while the other is open is what enforces that in the UI.
 */
const relatedSession = useDraftSession()

/**
 * A draft that could revise this entry, left open earlier. While there is one, Revise and Create
 * related entry give way to resuming it, so two drafts never write versions against one start
 * (PRODUCT.md §4.8). Read off the drafts list, which saving or discarding a draft reloads.
 */
const outstandingDraft = computed<DraftSnapshot | null>(
  () =>
    drafts.drafts.find((draft) =>
      versionsRevisedBy(draft).some((revised) => revised.entry_id === props.id),
    ) ?? null,
)

/** Two columns of readable width need more room than the page gives by default. */
const layoutWidth = useLayoutWidth()

/**
 * An entry nobody named is headed by the day it was written, set as a dateline rather than a title.
 *
 * Not `entryLabel`, which names an entry where only one line fits: here the text is already on the
 * page, so opening with a truncated copy of the sentence directly below it would only say the same
 * thing twice. The date is the half every entry has, and it stays put — a title can be revised away
 * and the opening words rewritten, but when a record was made does not move.
 */
const heading = computed(() => {
  const entry = aggregated.value
  if (!entry) return 'Entry detail'
  return entry.title || formatDateline(entry.created_at)
})

/** The muted line under the heading. An untitled entry's heading is already the day, so only the time. */
const metaLine = computed(() => {
  const entry = aggregated.value
  if (!entry) return ''

  const created = entry.title
    ? `Created ${formatDateline(entry.created_at)} at ${formatTime(entry.created_at)}`
    : `Created at ${formatTime(entry.created_at)}`
  return [created, ...(versionLabel.value ? [versionLabel.value] : [])].join(' · ')
})

/** The writer's own details, one line each. Empty when they gave none, so nothing is shown. */
const detailLines = computed(() => (aggregated.value ? entryDetailLines(aggregated.value) : []))

const versionLabel = computed(() => {
  const version = aggregated.value?.version
  if (!version || version.total <= 1) return null
  return `Version ${version.index} of ${version.total}`
})

/**
 * The related entry each disturbed anchor belongs to, named rather than merely counted
 * (PRODUCT.md §4.5).
 * Anchors, not related entries, are what a revision can disturb, so this reads them off each one's
 * resolved anchor list rather than off the entries themselves.
 */
const revisionWarnings = computed<string[]>(() => {
  if (revisionAffectedAnchorIds.value.length === 0) return []

  const owners = new Map<string, string>()
  for (const related of aggregated.value?.related_entries ?? []) {
    for (const anchor of related.anchors) {
      owners.set(anchor.anchor_id, entryLabel(related.entry))
    }
  }

  const names = revisionAffectedAnchorIds.value.map((id) => owners.get(id) ?? 'a related entry')
  return [...new Set(names)]
})

async function loadEntry(entryId: string): Promise<void> {
  loading.value = true
  error.value = null

  try {
    aggregated.value = await store.getAggregatedEntry(entryId)
    breadcrumbEntries.value = aggregated.value ? await loadBreadcrumb(aggregated.value) : []
  } catch (err) {
    // A failed fetch means there is no confirmed data for this id, so any previously-loaded
    // entry (from before navigating here) is cleared rather than left on screen under a
    // mismatched id.
    aggregated.value = null
    breadcrumbEntries.value = []
    error.value = toErrorMessage(err, 'Failed to load entry')
  } finally {
    loading.value = false
  }

  // Apart from the entry: failing to read drafts shouldn't blank a page that loaded.
  await findOutstandingDraft().catch((err) => {
    actionError.value = toErrorMessage(err, 'Failed to load drafts')
  })
}

/**
 * Re-reads the entry in place for a tab being returned to, since another tab may have saved a
 * version or a related entry since. It leaves `loading` alone: loading hides the article, which
 * would unmount an open composer and abandon its session.
 */
async function refreshEntry(): Promise<void> {
  const entryId = props.id
  if (loading.value || !aggregated.value) return

  try {
    const fresh = await store.getAggregatedEntry(entryId)
    const crumbs = fresh ? await loadBreadcrumb(fresh) : []
    if (entryId !== props.id) return // Navigated away while reading.

    aggregated.value = fresh
    breadcrumbEntries.value = crumbs
  } catch (err) {
    actionError.value = toErrorMessage(err, 'Failed to refresh entry')
  }
}

useTabReturn(() => void refreshEntry())

/**
 * Reads the drafts table for one that could revise this entry. Asked again whenever a new draft is
 * about to begin, not trusted from page load, since another tab may have started one since.
 */
async function findOutstandingDraft(): Promise<DraftSnapshot | null> {
  await drafts.loadDrafts()
  return outstandingDraft.value
}

/** Reopens the outstanding draft in place, in whichever composer it was written in. */
async function resumeOutstandingDraft(): Promise<void> {
  const draft = outstandingDraft.value
  if (!draft) return

  actionError.value = null
  const session = draft.kind === 'revision' ? revisionSession : relatedSession

  try {
    // Gone since the list was read: sealed or discarded elsewhere, so nothing is outstanding.
    if (!(await session.resume(draft.session_id))) await findOutstandingDraft()
  } catch (err) {
    actionError.value = toErrorMessage(err, 'Failed to resume draft')
  }
}

/** The label(s) an entry's breadcrumb line links to — its parent, or both ends of a connection. */
async function loadBreadcrumb(entry: AggregatedEntry): Promise<{ id: string; label: string }[]> {
  const ids: string[] =
    entry.relation_type === 'annotation' || entry.relation_type === 'update'
      ? entry.parent_id
        ? [entry.parent_id]
        : []
      : entry.relation_type === 'connection'
        ? [entry.parent_id, entry.target_id].filter((id): id is string => id !== null)
        : []

  if (ids.length === 0) return []

  // The aggregated form, not the raw row: title folds through the version chain like the rest of
  // the author-supplied fields (ENTRY_MODEL.md, "Version chains"), so reading the row directly
  // would show a stale or blank name for an entry a revision has since renamed.
  const found = await Promise.all(ids.map((id) => store.getAggregatedEntry(id)))
  return ids.flatMap((id, index) => {
    const other = found[index]
    return other ? [{ id, label: entryLabel(other) }] : []
  })
}

/** Lets go of the revision session: its work stays a draft, and an untouched claim is released. */
function resetRevisionState(): void {
  revisionSession.reset()
  revisionAffectedAnchorIds.value = []
}

/** Lets go of the anchor-mode session, the same way. */
function resetRelatedState(): void {
  relatedSession.reset()
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
    resetRelatedState()
    void loadEntry(entryId)
  },
)

// `post` because this reaches into the rendered <img> elements: running before the DOM updates
// would resolve the previous entry's attachments, or none at all on first load. `loading` is part
// of the source, not just a guard, because the attachments section is behind `v-else` on it: on
// first load, `aggregated` (and its `media_refs`) is set a tick before `loading` turns false, so a
// watch on `media_refs` alone fires while that section is still absent from the DOM and `mediaEl`
// is null. Keying on both means the watch re-fires once loading actually flips.
watch(
  () => (loading.value ? undefined : aggregated.value?.media_refs),
  () => {
    void media.applyTo(mediaEl.value)
  },
  { flush: 'post' },
)

// Raised only while the side-by-side session is open, and lowered again however it ends — saved,
// discarded, or navigated away from.
watch(
  () => relatedSession.isOpen,
  (open) => {
    layoutWidth.value = open ? 'wide' : 'normal'
  },
)

onBeforeUnmount(() => {
  layoutWidth.value = 'normal'
  // Leaving the page ends its sessions as surely as changing entry does.
  resetRevisionState()
  resetRelatedState()
})

/** Connections get the full entry model (title, dates, rich content), so they're a whole screen. */
function goToNewConnection(): void {
  void router.push({ name: 'new-connection', params: { id: props.id } })
}

/**
 * Opening an entry to revise it produces a pending revision draft, leaving the entry untouched
 * until it is sealed. The draft seeds from the current aggregate state rather than the stored
 * row, or an entry that has already been revised would reopen at its first version.
 */
async function startRevising(): Promise<void> {
  const current = aggregated.value
  if (!current || (await resumedInstead())) return

  revisionSession.begin({ kind: 'revision', parent: current })
}

/**
 * Before a new draft begins: reopens one already outstanding on this entry instead, and says
 * whether it did. A check that fails begins nothing either.
 */
async function resumedInstead(): Promise<boolean> {
  try {
    if (!(await findOutstandingDraft())) return false
  } catch (err) {
    actionError.value = toErrorMessage(err, 'Failed to load drafts')
    return true
  }

  await resumeOutstandingDraft()
  return true
}

function trackAffectedAnchors(change: EditorChange): void {
  revisionAffectedAnchorIds.value = change.affectedAnchorIds ?? []
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
 * related entry's own prose, sealing atomically together (AUTHORING.md, "Drafts").
 *
 * Anchoring is optional within it. Marking nothing and simply writing produces a related entry
 * about this one at large, which is why there is one way in here rather than a separate form.
 */
async function startRelatedEntry(): Promise<void> {
  const current = aggregated.value
  if (!current || (await resumedInstead())) return

  relatedSession.begin({ kind: 'new_related', parent: current })
}

/** Lands on the new related entry, whose breadcrumb leads back here. */
const saveRelatedEntry = useSealDraft(relatedSession, actionError)

async function cancelRelatedEntry(): Promise<void> {
  await relatedSession.discard()
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
    const where = resolved.quote ? `“${resolved.quote}”` : 'a point in the text'
    return resolved.insertion ? `On ${where}, adds “${resolved.insertion}”` : `On ${where}`
  }

  // No mark at all: a bare insertion with nothing struck.
  return resolved.insertion ? `Adds “${resolved.insertion}”` : 'On a point in the text'
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="text-sm text-[var(--color-text-muted)]">Loading entry...</div>

    <div v-else-if="error" class="text-sm text-[var(--color-error)]" role="alert">{{ error }}</div>

    <div v-else-if="!aggregated" class="text-sm text-[var(--color-text-muted)]">
      Entry not found.
    </div>

    <template v-else>
      <p v-if="actionError" class="text-sm text-[var(--color-error)]" role="alert">
        {{ actionError }}
      </p>

      <DraftElsewhereNotice :session="revisionSession" />
      <DraftElsewhereNotice :session="relatedSession" />

      <p
        v-if="breadcrumbKind"
        class="flex flex-wrap items-center gap-1 text-sm text-[var(--color-text-muted)]"
      >
        <span>{{ breadcrumbKind === 'connects' ? 'Connects' : 'About' }}</span>
        <template v-for="(crumb, index) in breadcrumbEntries" :key="crumb.id">
          <RouterLink
            :to="{ name: 'entry-detail', params: { id: crumb.id } }"
            class="text-[var(--color-accent)] hover:underline"
          >
            {{ crumb.label }}
          </RouterLink>
          <span v-if="index < breadcrumbEntries.length - 1" aria-hidden="true">↔</span>
        </template>
      </p>

      <article class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header class="mb-4">
          <!-- Wraps rather than squeezing: on a narrow screen, or beside a long title, the actions
               drop to their own line instead of crushing the heading into a column. -->
          <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <!-- An untitled entry's dateline is muted and unbolded, so it never reads as a title. -->
            <h1
              class="min-w-0 flex-1 basis-60 break-words text-xl"
              :class="aggregated.title ? 'font-semibold' : 'text-[var(--color-text-muted)]'"
            >
              {{ heading }}
            </h1>

            <div
              v-if="!revisionSession.isOpen && !relatedSession.isOpen"
              class="flex flex-wrap gap-2"
            >
              <button
                v-if="outstandingDraft"
                type="button"
                class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                @click="resumeOutstandingDraft"
              >
                Resume draft
              </button>
              <template v-else>
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
              </template>
              <button
                type="button"
                class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                @click="goToNewConnection"
              >
                Add connection
              </button>
            </div>
          </div>

          <p v-if="metaLine" class="mt-1 text-sm text-[var(--color-text-muted)]">{{ metaLine }}</p>
        </header>

        <template v-if="revisionSession.isOpen">
          <p class="mb-2 text-sm text-[var(--color-text-muted)]">
            Editing appends a new version. The current text stays in the entry's history either way.
          </p>

          <EntryComposer
            :session="revisionSession"
            label="Revised entry"
            save-label="Save revision"
            @change="trackAffectedAnchors"
            @save="saveRevision"
            @discard="cancelRevision"
          >
            <template #notices>
              <p
                v-if="revisionWarnings.length > 0"
                class="text-sm text-[var(--color-accent)]"
                role="status"
              >
                This changes the passage {{ revisionWarnings.join(', ') }}
                {{ revisionWarnings.length === 1 ? 'is' : 'are' }} about.
              </p>
            </template>
          </EntryComposer>
        </template>

        <template v-else-if="relatedSession.isOpen">
          <RelatedEntryComposer
            :session="relatedSession"
            @save="saveRelatedEntry"
            @discard="cancelRelatedEntry"
          />
        </template>

        <template v-else>
          <!-- Keyed on the version: the editor reads its content only on mount. The heading above is
               the title, so the document shows its body alone. -->
          <DocumentEditor
            :key="currentVersionId(aggregated)"
            label="Entry content"
            :content="aggregated.content"
            display-only
          />

          <div
            v-if="detailLines.length > 0"
            class="mt-4 space-y-1 border-t border-[var(--color-border)] pt-3 text-sm"
          >
            <p v-for="line in detailLines" :key="line">{{ line }}</p>
          </div>

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

        <section v-if="aggregated.related_entries.length > 0" class="mt-6 space-y-3">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Related entries
          </h2>

          <EntryCard
            v-for="related in aggregated.related_entries"
            :key="related.entry.id"
            :entry="related.entry"
          >
            <template #badge>
              <span class="text-xs uppercase tracking-wide text-[var(--color-accent)]">
                {{ related.relation_type }}
              </span>
            </template>

            <template #extra>
              <p v-if="related.has_children" class="mt-2 text-xs text-[var(--color-text-muted)]">
                has related entries
              </p>

              <ul v-if="related.anchors.length > 0" class="mt-2 space-y-1">
                <li
                  v-for="resolved in related.anchors"
                  :key="resolved.anchor_id"
                  class="text-xs text-[var(--color-text-muted)]"
                  :class="{ italic: resolved.status === 'orphaned' }"
                >
                  {{ describeAnchor(resolved) }}
                </li>
              </ul>
            </template>
          </EntryCard>
        </section>

        <section v-if="aggregated.connections.length > 0" class="mt-6 space-y-3">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Connections
          </h2>

          <EntryCard
            v-for="connection in aggregated.connections"
            :key="connection.entry.id"
            :entry="connection.entry"
          />
        </section>
      </article>
    </template>
  </div>
</template>
