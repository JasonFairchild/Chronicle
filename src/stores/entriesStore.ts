import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { anchorRefsFor, anchorsPlacedSince, relationTypeForAnchors } from '@/domain/anchors'
import {
  collectMediaRefs,
  docTitle,
  isEmptyDocument,
  sameContent,
  textContent,
} from '@/domain/entryDocument'
import { buildEntryHistory, reconstructEntryState } from '@/domain/reconstructEntryState'
import { entryRepository } from '@/repositories'
import type { Draft } from '@/types/draft'
import {
  createEntryInput,
  emptyEntryDates,
  type AggregatedEntry,
  type AuthoringTrace,
  type CreateEntryInput,
  type Entry,
  type EntryDates,
  type EntryVersion,
  type NarrativeRelation,
  type RevisionMode,
} from '@/types/entry'
import { toErrorMessage } from '@/utils/format'

export interface CreateChildOptions {
  parentId: string
  relationType: NarrativeRelation
  content: string
}

export interface CreateConnectionOptions {
  fromId: string
  toId: string
  content?: string
}

export interface ReviseEntryOptions {
  entryId: string
  content: string
  mediaRefs?: string[]
  metadata?: Record<string, unknown>
}

export const useEntriesStore = defineStore('entries', () => {
  // Immutable snapshots, replaced wholesale and never mutated in place, so deep reactivity would
  // only cost proxies. Keeping them raw also stops a proxy from reaching the repository, which
  // clones with structuredClone and cannot clone one.
  const rootEntries = shallowRef<AggregatedEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const rootCount = computed(() => rootEntries.value.length)

  /**
   * Timeline rows are aggregated, not raw, so a revised entry shows its current text. Reading the
   * stored row directly would always show version one.
   */
  async function loadRootEntries(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      rootEntries.value = await aggregateRoots()
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to load entries')
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * A simple, non-session way to create a root entry from plain text — no draft, no title, no
   * dates. The real UI always writes through a draft session (`createFromDraft`); this exists for
   * callers, chiefly tests, that just want an entry to exist.
   */
  async function createTextEntry(content: string): Promise<Entry> {
    const entry = await entryRepository.create(
      rootInput(requireContent(textContent(content)), null, emptyEntryDates()),
    )

    await addRoot(entry.id)
    return entry
  }

  /**
   * An annotation or an update about the parent at large, with no anchors, from plain text — the
   * simple counterpart to `createTextEntry` for children. A child that points at a specific passage
   * goes through an anchor-mode draft instead (`createFromDraft`), since placing an anchor means
   * revising the parent's own document.
   */
  async function createChildEntry(options: CreateChildOptions): Promise<Entry> {
    return entryRepository.create(
      childInput(
        requireContent(textContent(options.content)),
        options.parentId,
        options.relationType,
        emptyEntryDates(),
        { anchors: [] },
      ),
    )
  }

  /**
   * A directional edge from plain text — the simple counterpart to `createTextEntry` for
   * connections. The real UI always writes through `createFromDraft`'s `new_connection` branch,
   * which gets the full entry model (title, dates, rich content); this is for tests that just want
   * a connection to exist.
   */
  async function createConnection(options: CreateConnectionOptions): Promise<Entry> {
    error.value = null

    return entryRepository.create(
      createEntryInput({
        content: textContent(options.content?.trim() ?? ''),
        parent_id: options.fromId,
        target_id: options.toId,
        relation_type: 'connection',
      }),
    )
  }

  /**
   * Appends a new version from plain text — the simple counterpart to `createTextEntry` for
   * revisions. A revision is a full-state snapshot, so anything the caller is not changing is
   * carried forward from the current aggregate rather than from the original row, which is what
   * stops an edit from silently dropping the entry's media.
   */
  async function reviseEntry(options: ReviseEntryOptions): Promise<Entry> {
    const content = requireContent(textContent(options.content))
    const current = await getAggregatedEntry(options.entryId)
    if (!current) {
      throw new Error('Cannot revise an entry that does not exist')
    }
    if (sameContent(current.content, content)) {
      throw new Error('No changes to save')
    }

    const entry = await entryRepository.create(
      revisionInput(
        current,
        content,
        'direct',
        options.mediaRefs ?? collectMediaRefs(content),
        options.metadata ?? current.metadata,
        null,
      ),
    )

    await refreshRoot(options.entryId)
    return entry
  }

  /**
   * Turns one sealed draft into one immutable entry. The draft's `target` is the only thing that
   * decides what kind of entry that is, which is why the drafts list can describe an unsealed
   * session without opening it.
   *
   * Sealing is where the authoring trace lands, and it lands on whatever was typed: a first draft
   * as much as a later revision, because both are links in the same chain.
   *
   * `parentTrace` is the parent document's own step chain, present only for an anchor-mode `new_child`
   * draft — see ENTRY_MODEL.md, "Drafts". It is a second, independent trace because the parent and
   * the child are two different documents with two different authoring histories, sealed together.
   */
  async function createFromDraft(
    draft: Draft,
    trace: AuthoringTrace | null,
    parentTrace: AuthoringTrace | null = null,
  ): Promise<Entry> {
    const content = requireContent(draft.child.content)
    const { target } = draft

    if (target.kind === 'new_child') {
      // Read off the two documents rather than a list kept alongside them, so an anchor placed and
      // then removed before sealing leaves nothing behind to subtract — see `anchorsPlacedSince`.
      const anchorIds = anchorsPlacedSince(
        draft.parent?.base_content ?? null,
        draft.parent?.content ?? null,
      )

      if (anchorIds.length === 0) {
        // Nothing was placed on the parent, so this is a note about the entry at large: one entry,
        // no revision, exactly like `createChildEntry`. With nothing anchored there is nothing for
        // `relationTypeForAnchors` to read, and its answer for that case is annotation.
        return entryRepository.create(
          childInput(content, target.parent_id, 'annotation', draft.dates, {
            anchors: [],
            authoring_trace: trace,
          }),
        )
      }

      return sealAnchorChild(draft, target.parent_id, content, anchorIds, trace, parentTrace)
    }

    if (target.kind === 'revision') {
      const current = await getAggregatedEntry(target.parent_id)
      if (!current) {
        throw new Error('Cannot revise an entry that does not exist')
      }
      if (sameContent(current.content, content)) {
        throw new Error('No changes to save')
      }

      const entry = await entryRepository.create(
        revisionInput(
          current,
          content,
          'direct',
          collectMediaRefs(content),
          current.metadata,
          trace,
        ),
      )

      await refreshRoot(target.parent_id)
      return entry
    }

    if (target.kind === 'new_connection') {
      // Never a timeline root — a connection is reached through the entries it links, not the
      // timeline, so there is no `addRoot` here the way there is for `new_root`.
      return entryRepository.create(
        createEntryInput({
          content,
          title: docTitle(content),
          parent_id: target.parent_id,
          target_id: target.target_id,
          relation_type: 'connection',
          media_refs: collectMediaRefs(content),
          authoring_trace: trace,
          dates: draft.dates,
        }),
      )
    }

    const entry = await entryRepository.create(rootInput(content, trace, draft.dates))

    await addRoot(entry.id)
    return entry
  }

  /**
   * The atomic half of sealing an anchor-mode draft: a parent revision carrying the new anchors,
   * plus the child referencing them, written together via `createMany` so the pair can never land
   * half-written (ENTRY_MODEL.md, "Drafts").
   *
   * Whether the child reads as an annotation or an update is derived from what was anchored rather
   * than asked for up front — see `relationTypeForAnchors`. `anchorIds` is likewise derived, by the
   * caller, from the difference between the draft's base and current parent documents.
   */
  async function sealAnchorChild(
    draft: Draft,
    parentId: string,
    content: string,
    anchorIds: string[],
    trace: AuthoringTrace | null,
    parentTrace: AuthoringTrace | null,
  ): Promise<Entry> {
    const parentContent = draft.parent?.content
    if (parentContent === undefined) {
      throw new Error('An anchor-mode draft is missing its parent document')
    }

    const current = await getAggregatedEntry(parentId)
    if (!current) {
      throw new Error('Cannot annotate an entry that does not exist')
    }

    const [, child] = await entryRepository.createMany([
      revisionInput(
        current,
        parentContent,
        'anchor',
        collectMediaRefs(parentContent),
        current.metadata,
        parentTrace,
      ),
      childInput(content, parentId, relationTypeForAnchors(anchorIds, parentContent), draft.dates, {
        anchors: anchorRefsFor(anchorIds, parentContent),
        authoring_trace: trace,
      }),
    ])

    await refreshRoot(parentId)
    return child!
  }

  async function getEntry(id: string): Promise<Entry | null> {
    return entryRepository.getById(id)
  }

  async function getAggregatedEntry(id: string, asOf?: Date): Promise<AggregatedEntry | null> {
    // Only this entry's subtree, not the whole database. Revisions multiply row counts faster
    // than anything else in the model, so a detail view must never load everything.
    const relevant = await entryRepository.listDescendants(id)
    return reconstructEntryState(id, relevant, { asOf })
  }

  /** The full version chain for one entry, oldest first. */
  async function getEntryHistory(id: string): Promise<EntryVersion[]> {
    const relevant = await entryRepository.listDescendants(id)
    return buildEntryHistory(id, relevant) ?? []
  }

  async function aggregateRoots(): Promise<AggregatedEntry[]> {
    const roots = await entryRepository.listRootEntries()

    // A card needs each root folded over its own revisions and nothing else, so it asks for
    // exactly that. The persistent adapter should collapse this into one query rather than
    // reaching for listAll, which would load the whole database to render a list. The revision
    // fetches are independent of each other, so they run concurrently rather than one root's
    // round trip waiting on the last.
    const states = await Promise.all(
      roots.map(async (root) => {
        const revisions = await entryRepository.listRevisions(root.id)
        return reconstructEntryState(root.id, [root, ...revisions], { depth: 0 })
      }),
    )

    return states.filter((state): state is AggregatedEntry => state !== null)
  }

  /**
   * Re-aggregates one root in place. Revising an entry only ever needs its own card refreshed —
   * reloading every root over again after each write would make every save cost more as the
   * timeline grows, for entries that did not change.
   */
  async function refreshRoot(rootId: string): Promise<void> {
    const [root, revisions] = await Promise.all([
      entryRepository.getById(rootId),
      entryRepository.listRevisions(rootId),
    ])
    if (!root) return

    const state = reconstructEntryState(rootId, [root, ...revisions], { depth: 0 })
    if (!state) return

    const index = rootEntries.value.findIndex((entry) => entry.id === rootId)
    if (index === -1) return

    const next = [...rootEntries.value]
    next[index] = state
    rootEntries.value = next
  }

  /**
   * Adds a freshly created root without re-fetching the rest. Ids are UUIDv7 and generated one
   * client at a time, so a brand-new root is always the most recent thing in the list — it can be
   * placed at the front directly rather than re-sorting everything already loaded.
   */
  async function addRoot(rootId: string): Promise<void> {
    const root = await entryRepository.getById(rootId)
    if (!root) return

    const state = reconstructEntryState(rootId, [root], { depth: 0 })
    if (!state) return

    rootEntries.value = [state, ...rootEntries.value]
  }

  /** A root caches its document's title node; media is whatever the document points at. */
  function rootInput(
    content: string,
    trace: AuthoringTrace | null,
    dates: EntryDates,
  ): CreateEntryInput {
    return createEntryInput({
      content,
      title: docTitle(content),
      media_refs: collectMediaRefs(content),
      authoring_trace: trace,
      dates,
    })
  }

  function childInput(
    content: string,
    parentId: string,
    relationType: NarrativeRelation,
    dates: EntryDates,
    extra: Partial<CreateEntryInput>,
  ): CreateEntryInput {
    return createEntryInput({
      content,
      title: docTitle(content),
      parent_id: parentId,
      relation_type: relationType,
      media_refs: collectMediaRefs(content),
      dates,
      ...extra,
    })
  }

  /**
   * A revision's `CreateEntryInput`. Shared by `reviseEntry` and the two revision-writing branches
   * of `createFromDraft` (an ordinary direct revision, and the parent half of an anchor-mode
   * seal) — the only differences between them are the revision mode and which trace and
   * media/metadata values the caller has already resolved.
   *
   * It takes the current aggregate rather than an id because a version carries the author's dates,
   * location and medium as well as the document: anything this revision is not changing has to be
   * written forward onto it, or the fold would read the newest version and find nulls.
   */
  function revisionInput(
    current: AggregatedEntry,
    content: string,
    revisionMode: RevisionMode,
    mediaRefs: string[],
    metadata: Record<string, unknown>,
    trace: AuthoringTrace | null,
  ): CreateEntryInput {
    return createEntryInput({
      content,
      parent_id: current.id,
      relation_type: 'revision',
      revision_mode: revisionMode,
      media_refs: mediaRefs,
      metadata,
      authoring_trace: trace,
      dates: current.dates,
      location: current.location,
      original_medium: current.original_medium,
      original_medium_note: current.original_medium_note,
    })
  }

  /**
   * The one thing that must be true of any document about to become an entry: it has to say
   * something. A title is not among the conditions — an entry may be saved unnamed, and
   * `entryLabel` names it by its opening words wherever one line is all there is room for.
   */
  function requireContent(content: string): string {
    error.value = null
    const trimmed = content.trim()
    if (isEmptyDocument(trimmed)) {
      throw new Error('Entry content cannot be empty')
    }
    return trimmed
  }

  return {
    rootEntries,
    loading,
    error,
    rootCount,
    loadRootEntries,
    createTextEntry,
    createChildEntry,
    createConnection,
    reviseEntry,
    createFromDraft,
    getEntry,
    getAggregatedEntry,
    getEntryHistory,
  }
})
