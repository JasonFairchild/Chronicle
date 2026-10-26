import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { anchorRefsFor, anchorsPlacedSince, relationTypeForAnchors } from '@/domain/anchors'
import {
  collectMediaRefs,
  isBlankDraft,
  isEmptyDocument,
  sameDocument,
} from '@/domain/entryDocument'
import { reconstructEntryState } from '@/domain/reconstructEntryState'
import { entryRepository } from '@/repositories'
import type { DraftSnapshot } from '@/types/draft'
import {
  type AggregatedEntry,
  type AuthoringTrace,
  type CreateEntryInput,
  createEntryInput,
  type Entry,
  type EntryDates,
  type NarrativeRelation,
  type RevisionMode,
  type VersionedFields,
  versionedFieldsOf,
} from '@/types/entry'
import { toErrorMessage } from '@/utils/format'

export const useEntriesStore = defineStore('entries', () => {
  // Immutable snapshots, replaced wholesale and never mutated in place, so deep reactivity would
  // only cost proxies. Keeping them raw also stops a proxy from reaching the repository, which
  // clones with structuredClone and cannot clone one.
  const rootEntries = shallowRef<AggregatedEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function aggregateRoots(): Promise<AggregatedEntry[]> {
    const roots = await entryRepository.listRootEntries()

    // A card needs each root folded over its own revisions and nothing else, so it asks for
    // exactly that rather than loading the whole table to render a list. The revision fetches are
    // independent, so they run concurrently rather than one root's round trip waiting on the last.
    const states = await Promise.all(
      roots.map(async (root) => {
        const revisions = await entryRepository.listRevisions(root.id)
        return reconstructEntryState(root.id, [root, ...revisions], { depth: 0 })
      }),
    )

    return states.filter((state): state is AggregatedEntry => state !== null)
  }

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

  async function getAggregatedEntry(id: string, asOf?: Date): Promise<AggregatedEntry | null> {
    // Only this entry's subtree, not the whole database. Revisions multiply row counts faster
    // than anything else in the model, so a detail view must never load everything.
    const relevant = await entryRepository.listDescendants(id)
    return reconstructEntryState(id, relevant, { asOf })
  }

  /**
   * The one thing that must be true of any document about to become an entry: its body has to say
   * something, in words or an image. A title doesn't count — it names an entry without being one.
   */
  function requireContent(content: string): void {
    error.value = null
    if (isEmptyDocument(content)) {
      throw new Error('Entry content cannot be empty')
    }
  }

  /**
   * Blank collapses to null, the same as an untyped field: whitespace left behind in a title input
   * is not a name any more than it would be if typed into the body and abandoned. Every write path
   * funnels through here, rather than trusting each caller to have normalized it already.
   */
  function normalizeTitle(title: string | null): string | null {
    return title?.trim() || null
  }

  /**
   * The version a draft seals into: the fields the writer set beside the document, and the media
   * the document references. Unguarded, so `draftHoldsWork` can compare a revision whose body was
   * emptied; sealing calls `requireContent` first.
   */
  function fieldsFromDraft(entry: DraftSnapshot['entry']): VersionedFields {
    return versionedFieldsOf({
      ...entry,
      title: normalizeTitle(entry.title),
      media_refs: collectMediaRefs(entry.content),
    })
  }

  function rootInput(fields: VersionedFields, trace: AuthoringTrace | null): CreateEntryInput {
    return createEntryInput({ ...fields, authoring_trace: trace })
  }

  function relatedInput(
    fields: VersionedFields,
    parentId: string,
    relationType: NarrativeRelation,
    extra: Partial<CreateEntryInput>,
  ): CreateEntryInput {
    return createEntryInput({
      ...fields,
      parent_id: parentId,
      relation_type: relationType,
      ...extra,
    })
  }

  /**
   * A revision's `CreateEntryInput`. `fields` is the whole new version, not only what changed: a
   * version carries the author's dates, location, medium, and title as well as the document, and
   * the fold reads the newest one alone, so anything a revision leaves out would read as null.
   */
  function revisionInput(
    entryId: string,
    fields: VersionedFields,
    revisionMode: RevisionMode,
    baseVersionId: string | null,
    trace: AuthoringTrace | null,
  ): CreateEntryInput {
    return createEntryInput({
      ...fields,
      parent_id: entryId,
      relation_type: 'revision',
      revision_mode: revisionMode,
      base_version_id: baseVersionId,
      authoring_trace: trace,
    })
  }

  /**
   * An anchor-mode seal: a parent revision carrying the new anchors, plus the related entry
   * referencing them. Written in one `createMany`, the pair can never land half-written
   * (AUTHORING.md, "Drafts").
   *
   * Whether it reads as an annotation or an update is derived from what was anchored rather than
   * asked for up front — see `relationTypeForAnchors`. `anchorIds` is likewise derived, by the
   * caller, from the difference between the draft's base and current parent documents.
   */
  async function anchoredInputs(
    draft: Extract<DraftSnapshot, { kind: 'new_related' }>,
    fields: VersionedFields,
    anchorIds: string[],
    trace: AuthoringTrace | null,
    parentTrace: AuthoringTrace | null,
  ): Promise<CreateEntryInput[]> {
    const parentContent = draft.parent.content

    const current = await getAggregatedEntry(draft.parent_id)
    if (!current) {
      throw new Error('Cannot annotate an entry that does not exist')
    }

    return [
      // Anchor mode changes nothing about the parent but its document, so every other field is the
      // current version's. The write refuses it if that isn't the version the draft started from.
      revisionInput(
        current.id,
        {
          ...versionedFieldsOf(current),
          content: parentContent,
          media_refs: collectMediaRefs(parentContent),
        },
        'anchor',
        draft.parent.base_version_id,
        parentTrace,
      ),
      relatedInput(fields, draft.parent_id, relationTypeForAnchors(anchorIds, parentContent), {
        anchors: anchorRefsFor(anchorIds, parentContent),
        authoring_trace: trace,
      }),
    ]
  }

  /**
   * Whether a new version would change nothing a version holds. Documents compare by `sameDocument`,
   * so formatting alone is a change; `media_refs` follows from the document.
   */
  function sameVersion(a: VersionedFields, b: VersionedFields): boolean {
    const dateKeys = Object.keys(a.dates) as (keyof EntryDates)[]

    return (
      sameDocument(a.content, b.content) &&
      a.title === b.title &&
      dateKeys.every((key) => a.dates[key] === b.dates[key]) &&
      a.location === b.location &&
      a.original_medium === b.original_medium &&
      a.original_medium_note === b.original_medium_note &&
      JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
    )
  }

  /**
   * The entries sealing a draft writes, in order, the one the draft was for last. The draft's
   * `kind` is the only thing that decides what they are, which is why the drafts list can describe
   * an unsealed session without opening it. Writing them is the draft repository's `seal`, so the
   * draft goes in the same transaction.
   *
   * Sealing is where the authoring trace lands, and it lands on whatever was typed: a first draft
   * as much as a later revision, because both are links in the same chain.
   *
   * `parentTrace` is the parent document's own trace, present only for an anchor-mode
   * `new_related` draft — see AUTHORING.md, "Drafts". It is a second, independent trace because the
   * two are different documents with different authoring histories, sealed together.
   */
  async function inputsForDraft(
    draft: DraftSnapshot,
    trace: AuthoringTrace | null,
    parentTrace: AuthoringTrace | null = null,
  ): Promise<CreateEntryInput[]> {
    requireContent(draft.entry.content)
    const fields = fieldsFromDraft(draft.entry)

    switch (draft.kind) {
      case 'new_related': {
        // Read off the two documents rather than a list kept alongside them, so an anchor placed
        // and then removed before sealing leaves nothing behind to subtract — see
        // `anchorsPlacedSince`.
        const anchorIds = anchorsPlacedSince(draft.parent.base_content, draft.parent.content)
        if (anchorIds.length > 0) {
          return anchoredInputs(draft, fields, anchorIds, trace, parentTrace)
        }

        // Nothing was placed on the parent, so this is about the parent at large: one entry, no
        // revision. With nothing anchored there is nothing for `relationTypeForAnchors` to read,
        // and its answer for that case is annotation.
        return [
          relatedInput(fields, draft.parent_id, 'annotation', {
            anchors: [],
            authoring_trace: trace,
          }),
        ]
      }

      case 'revision': {
        const current = await getAggregatedEntry(draft.parent_id)
        if (!current) {
          throw new Error('Cannot revise an entry that does not exist')
        }
        if (sameVersion(current, fields)) {
          throw new Error('No changes to save')
        }

        return [
          revisionInput(draft.parent_id, fields, 'direct', draft.entry.base_version_id, trace),
        ]
      }

      case 'new_connection':
        return [
          createEntryInput({
            ...fields,
            parent_id: draft.parent_id,
            target_id: draft.target_id,
            relation_type: 'connection',
            authoring_trace: trace,
          }),
        ]

      case 'new_root':
        return [rootInput(fields, trace)]
    }
  }

  /**
   * Whether a draft holds anything worth keeping: words, anchors placed on its parent, or for a
   * revision, some difference from the version it would follow. A draft let go without being saved
   * is kept only if it does.
   */
  async function draftHoldsWork(draft: DraftSnapshot): Promise<boolean> {
    const anchored =
      draft.kind === 'new_related' &&
      anchorsPlacedSince(draft.parent.base_content, draft.parent.content).length > 0
    if (isBlankDraft(draft.entry.content, draft.entry.title)) return anchored
    if (draft.kind !== 'revision') return true

    const current = await getAggregatedEntry(draft.parent_id)
    return !current || !sameVersion(current, fieldsFromDraft(draft.entry))
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
   * Brings the timeline up to date with entries just written: a new root joins it, and a revised
   * root is refreshed. Everything else is reached through an entry already shown.
   */
  async function showWritten(written: Entry[]): Promise<void> {
    for (const entry of written) {
      if (entry.relation_type === null) await addRoot(entry.id)
      else if (entry.relation_type === 'revision' && entry.parent_id) {
        await refreshRoot(entry.parent_id)
      }
    }
  }

  return {
    rootEntries,
    loading,
    error,
    loadRootEntries,
    getAggregatedEntry,
    inputsForDraft,
    draftHoldsWork,
    showWritten,
  }
})
