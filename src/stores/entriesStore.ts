import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  collectMediaRefs,
  docTitle,
  isEmptyDocument,
  isSerializedDocument,
} from '@/domain/entryDocument'
import { buildEntryHistory, reconstructEntryState } from '@/domain/reconstructEntryState'
import { entryRepository } from '@/repositories'
import type { Draft } from '@/types/draft'
import {
  createEntryInput,
  type AggregatedEntry,
  type AnchorOp,
  type AuthoringTrace,
  type CreateEntryInput,
  type Entry,
  type EntryVersion,
  type NarrativeRelation,
} from '@/types/entry'

export interface CreateChildOptions {
  parentId: string
  relationType: NarrativeRelation
  content: string
  /** Places in the parent this child is about. Empty means the parent at large. */
  anchors?: AnchorOp[]
}

export interface CreateConnectionOptions {
  fromId: string
  toId: string
  content?: string
  label?: string
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
      error.value = err instanceof Error ? err.message : 'Failed to load entries'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createTextEntry(content: string): Promise<Entry> {
    const entry = await entryRepository.create(rootInput(requireContent(content), null))

    rootEntries.value = await aggregateRoots()
    return entry
  }

  /** An annotation or an update. Neither ever alters the parent's stored text. */
  async function createChildEntry(options: CreateChildOptions): Promise<Entry> {
    return entryRepository.create(
      childInput(requireContent(options.content), options.parentId, options.relationType, {
        anchors: options.anchors ?? [],
      }),
    )
  }

  /** A directional edge. `fromId` is where it was authored; both endpoints will surface it. */
  async function createConnection(options: CreateConnectionOptions): Promise<Entry> {
    error.value = null

    return entryRepository.create(
      createEntryInput({
        content: options.content?.trim() ?? '',
        parent_id: options.fromId,
        target_id: options.toId,
        relation_type: 'connection',
        metadata: options.label ? { connection_label: options.label } : {},
      }),
    )
  }

  /**
   * Appends a new version. A revision is a full-state snapshot, so anything the caller is not
   * changing is carried forward from the current aggregate rather than from the original row,
   * which is what stops an edit from silently dropping the entry's media.
   */
  async function reviseEntry(options: ReviseEntryOptions): Promise<Entry> {
    const content = requireContent(options.content)
    const current = await getAggregatedEntry(options.entryId)
    if (!current) {
      throw new Error('Cannot revise an entry that does not exist')
    }

    const entry = await entryRepository.create(
      createEntryInput({
        content,
        parent_id: options.entryId,
        relation_type: 'revision',
        media_refs: options.mediaRefs ?? mediaRefsFor(content, current.media_refs),
        metadata: options.metadata ?? current.metadata,
      }),
    )

    rootEntries.value = await aggregateRoots()
    return entry
  }

  /**
   * Turns one sealed draft into one immutable entry. The draft's `target` is the only thing that
   * decides what kind of entry that is, which is why the drafts list can describe an unsealed
   * session without opening it.
   *
   * Sealing is where the authoring trace lands, and it lands on whatever was typed: a first draft
   * as much as a later revision, because both are links in the same chain.
   */
  async function createFromDraft(draft: Draft, trace: AuthoringTrace | null): Promise<Entry> {
    const content = requireContent(draft.content)
    const { target } = draft

    if (target.kind === 'new_child') {
      return entryRepository.create(
        childInput(content, target.parent_id, target.relation_type, {
          anchors: draft.anchors,
          authoring_trace: trace,
        }),
      )
    }

    if (target.kind === 'revision') {
      const current = await getAggregatedEntry(target.parent_id)
      if (!current) {
        throw new Error('Cannot revise an entry that does not exist')
      }

      const entry = await entryRepository.create(
        createEntryInput({
          content,
          parent_id: target.parent_id,
          relation_type: 'revision',
          media_refs: mediaRefsFor(content, current.media_refs),
          metadata: current.metadata,
          authoring_trace: trace,
        }),
      )

      rootEntries.value = await aggregateRoots()
      return entry
    }

    const entry = await entryRepository.create(rootInput(content, trace))

    rootEntries.value = await aggregateRoots()
    return entry
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
    const states: AggregatedEntry[] = []

    // A card needs each root folded over its own revisions and nothing else, so it asks for
    // exactly that. The persistent adapter should collapse this into one query rather than
    // reaching for listAll, which would load the whole database to render a list.
    for (const root of roots) {
      const revisions = await entryRepository.listRevisions(root.id)
      const state = reconstructEntryState(root.id, [root, ...revisions], { depth: 0 })
      if (state) states.push(state)
    }

    return states
  }

  /** A root caches its document's title node; media is whatever the document points at. */
  function rootInput(content: string, trace: AuthoringTrace | null): CreateEntryInput {
    return createEntryInput({
      content,
      title: docTitle(content),
      media_refs: collectMediaRefs(content),
      authoring_trace: trace,
    })
  }

  /** Children hide the title field and leave it null; the title belongs to the entry being read. */
  function childInput(
    content: string,
    parentId: string,
    relationType: NarrativeRelation,
    extra: Partial<CreateEntryInput>,
  ): CreateEntryInput {
    return createEntryInput({
      content,
      parent_id: parentId,
      relation_type: relationType,
      media_refs: collectMediaRefs(content),
      ...extra,
    })
  }

  /**
   * A document knows which blobs it depends on, so it is the authority on its own media. Legacy
   * plain text knows nothing, so the previous version's list is carried forward rather than being
   * derived away to nothing, which is the rule that a revision must never silently drop images.
   */
  function mediaRefsFor(content: string, carriedForward: string[]): string[] {
    return isSerializedDocument(content) ? collectMediaRefs(content) : carriedForward
  }

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
