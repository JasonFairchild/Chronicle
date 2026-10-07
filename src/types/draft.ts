import { emptyEntryDetails, versionedFieldsOf } from './entry'
import type { AuthoringEvent, VersionedFields } from './entry'

/** One document a session is writing: where it started and where it is. */
export interface DraftDocument {
  base_version_id: string | null // The version it started from; null for a new entry.
  base_content: string // The document as this session found it, never rewritten.
  content: string
  events: AuthoringEvent[]
}

/**
 * The versioned fields a draft carries beside its document, which its entry is sealed with.
 * `media_refs` is derived from the document when sealing, so a stored copy could only drift.
 */
export type DraftFields = Omit<VersionedFields, 'content' | 'media_refs'>

/** The entry a session produces: its document plus every versioned field written beside it. */
export type DraftEntry = DraftDocument & DraftFields

/**
 * A draft whose documents are `Doc`, so one union serves with event logs and without. `parent`
 * exists only for `new_related` (anchor mode): if it gains anchors, they seal into its own
 * revision. Id fields mirror the `Entry` fields each kind writes.
 */
type DraftOf<Doc> = {
  session_id: string
  started_at: string // Shared by both documents' traces when sealing.
  updated_at: string
  entry: Doc & DraftFields
} & (
  | { kind: 'new_root' }
  | { kind: 'new_related'; parent_id: string; parent: Doc }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent_id: string }
)

/** A writing session in progress; unlike an entry, it rewrites itself (AUTHORING.md, "Drafts"). */
export type Draft = DraftOf<DraftDocument>

/**
 * A draft without its event logs: what the drafts list reads, what a stored draft row holds, and
 * what the store keeps beside the recorders that own the logs. The logs are a draft's one unbounded
 * part, so nothing that needs only the snapshot pays for them.
 */
export type DraftSnapshot = DraftOf<Omit<DraftDocument, 'events'>>

/** Which of a draft's documents an event log belongs to. */
export type DraftDocumentRole = 'entry' | 'parent'

/** A draft's event logs, one per document. `parent` is ignored for a draft without one. */
export type DraftEvents = Record<DraftDocumentRole, AuthoringEvent[]>

/**
 * The existing entries a draft could write a version of, each with the version it started from.
 * While one is outstanding, nothing else is offered that could revise the same entry (PRODUCT.md
 * §4.8). A connection revises nothing; a related entry revises its parent only once something is
 * anchored, but that can happen at any moment, so it counts.
 */
export function versionsRevisedBy(
  draft: DraftSnapshot,
): { entry_id: string; base_version_id: string | null }[] {
  switch (draft.kind) {
    case 'revision':
      return [{ entry_id: draft.parent_id, base_version_id: draft.entry.base_version_id }]
    case 'new_related':
      return [{ entry_id: draft.parent_id, base_version_id: draft.parent.base_version_id }]
    default:
      return []
  }
}

/** A new entry's side of a draft before anything is typed: an empty document, every field unset. */
export function newDraftEntry(): DraftSnapshot['entry'] {
  return {
    base_version_id: null,
    base_content: '',
    content: '',
    ...emptyEntryDetails(),
    title: null,
    metadata: {},
  }
}

/** The draft fields copied off a version, so revising starts from what the entry says now. */
export function draftFieldsOf(source: VersionedFields): DraftFields {
  const { content: _content, media_refs: _mediaRefs, ...fields } = versionedFieldsOf(source)
  return fields
}

/** The draft without its event logs. */
export function toSnapshot(draft: Draft): DraftSnapshot {
  const { events: _entryEvents, ...entry } = draft.entry
  if (draft.kind !== 'new_related') return { ...draft, entry }

  const { events: _parentEvents, ...parent } = draft.parent
  return { ...draft, entry, parent }
}

/** A snapshot rejoined with its event logs. */
export function withEvents(snapshot: DraftSnapshot, events: DraftEvents): Draft {
  const entry = { ...snapshot.entry, events: events.entry }
  if (snapshot.kind !== 'new_related') return { ...snapshot, entry }

  return { ...snapshot, entry, parent: { ...snapshot.parent, events: events.parent } }
}
