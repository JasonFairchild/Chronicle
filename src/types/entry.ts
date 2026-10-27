// The unified Entry model. See ENTRY_MODEL.md for the reasoning behind these shapes.

export type NarrativeRelation = 'annotation' | 'update'
export type EdgeRelation = 'connection'
export type VersionRelation = 'revision'

/** `connection` and `revision` are structural; `annotation`/`update` are a label only. */
export type RelationType = NarrativeRelation | EdgeRelation | VersionRelation

export interface AnchorRef {
  anchor_id: string
  quote: string
}

export type RevisionMode = 'direct' | 'anchor'

/**
 * The facts about one editor change that marks are derived from (AUTHORING.md, "Authoring
 * capture"). Stored rather than re-derived, since most need the document as it stood around the
 * change.
 */
export interface ChangeSignals {
  /** Empty for a deletion or a pure formatting change. */
  inserted_text: string
  /** Measured against the document each step saw before it applied. */
  removed_chars: number
  /** A mark or node-type change rather than text. */
  is_formatting: boolean
  /** Placing, switching or removing an anchor; not typing its wording. */
  is_anchor_op: boolean
  /** The transaction's own `uiEvent` meta, so a drop doesn't count. */
  is_paste: boolean
  /** An image attached or removed. */
  media_changed: boolean
}

/**
 * One editor change. Signals are stored sparse: only the ones that are set, so a plain keystroke
 * adds just `inserted_text`, and a missing field reads as false, `0` or `''`.
 */
export interface EditEvent extends Partial<ChangeSignals> {
  kind: 'edit'
  /** Milliseconds since the trace's `started_at`. */
  at: number
  /** Serialized ProseMirror steps, in order. */
  steps: unknown[]
}

/** A bookmark the writer asked for. */
export interface ManualEvent {
  kind: 'manual'
  at: number
}

/** The log's order is the total order: `at` can tie. */
export type AuthoringEvent = EditEvent | ManualEvent

/** How one writing session produced its snapshot. */
export interface AuthoringTrace {
  session_id: string
  started_at: string
  ended_at: string
  /** The document the first event applies to. */
  base_content: string
  events: AuthoringEvent[]
}

export interface EntryDates {
  recorded_at: string | null
  recorded_time_note: string | null
  occurred_at: string | null
  occurred_time_note: string | null
}

export function emptyEntryDates(): EntryDates {
  return {
    recorded_at: null,
    recorded_time_note: null,
    occurred_at: null,
    occurred_time_note: null,
  }
}

/** Everything a revision replaces. See ENTRY_MODEL.md, "Version chains". */
export interface VersionedFields {
  dates: EntryDates
  /** A name the author reuses, not coordinates. */
  location: string | null
  /** Where it was first written, for imports and recreations. */
  original_medium: string | null
  original_medium_note: string | null
  title: string | null
  content: string
  /** Blob ids in the media store. */
  media_refs: string[]
  /** Only what neither drives domain logic nor gets queried. */
  metadata: Record<string, unknown>
}

/** What a writer sets beside an entry's title and document: when, where, and what it was first written in. */
export type EntryDetails = Pick<
  VersionedFields,
  'dates' | 'location' | 'original_medium' | 'original_medium_note'
>

export function emptyEntryDetails(): EntryDetails {
  return {
    dates: emptyEntryDates(),
    location: null,
    original_medium: null,
    original_medium_note: null,
  }
}

/** Copies the details off any carrier into plain objects, dates included, so the copy aliases nothing. */
export function entryDetailsOf(source: EntryDetails): EntryDetails {
  return {
    dates: { ...source.dates },
    location: source.location,
    original_medium: source.original_medium,
    original_medium_note: source.original_medium_note,
  }
}

/** Shallow-copies the versioned fields off any carrier, so a version never aliases the row it came from. */
export function versionedFieldsOf(source: VersionedFields): VersionedFields {
  return {
    dates: { ...source.dates },
    location: source.location,
    original_medium: source.original_medium,
    original_medium_note: source.original_medium_note,
    title: source.title,
    content: source.content,
    media_refs: [...source.media_refs],
    metadata: { ...source.metadata },
  }
}

export interface Entry extends VersionedFields {
  /** UUIDv7 — sortable as text. */
  id: string
  /** System-set, immutable. */
  created_at: string
  parent_id: string | null
  relation_type: RelationType | null
  /** Connections only. */
  target_id: string | null
  /** Empty means the entry is about its parent at large. */
  anchors: AnchorRef[]
  /** Revisions only. */
  revision_mode: RevisionMode | null
  /** Revisions only: the version this one replaced. */
  base_version_id: string | null
  authoring_trace: AuthoringTrace | null
}

// From here down: shapes derived from or about Entry, not one of its own field types.

export type AnchorKind = 'comment' | 'strike'

/** Whether the parent's document still carries this anchor. */
export type AnchorStatus = 'present' | 'orphaned'

export interface ResolvedAnchor {
  anchor_id: string
  status: AnchorStatus
  /** Current wording if present, the sealed quote if orphaned. */
  quote: string
  /** Null when orphaned or a bare insertion. */
  kind: AnchorKind | null
  insertion: string | null
}

/**
 * One link in an entry's version chain. Version one has a null `revision_id`.
 *
 * A version carries every field a revision may change, not the document alone, so correcting
 * a date or a location is an ordinary revision and the value it replaced stays on record.
 */
export interface EntryVersion extends VersionedFields {
  revision_id: string | null
  at: string
}

export interface ResolvedRelatedEntry {
  entry: AggregatedEntry
  relation_type: RelationType
  /** Its anchors, read out of the parent's current document. */
  anchors: ResolvedAnchor[]
  /** Grandchildren are indicated, not expanded. */
  has_children: boolean
}

export interface ResolvedConnection {
  entry: AggregatedEntry
  /** The endpoint that is not the entry being viewed. */
  other_id: string
  direction: 'outgoing' | 'incoming'
}

/**
 * An entry's own state at a point in time, plus its relations as collections. The inherited
 * fields are the newest applicable revision's, not necessarily the entry's own row.
 */
export interface AggregatedEntry extends VersionedFields {
  id: string
  created_at: string
  /** Null for a root entry. */
  parent_id: string | null
  relation_type: RelationType | null
  /** Connections only. */
  target_id: string | null
  version: { index: number; total: number; at: string; revision_id: string | null }
  related_entries: ResolvedRelatedEntry[]
  connections: ResolvedConnection[]
}

export type CreateEntryInput = Omit<Entry, 'id' | 'created_at'>

export function createEntryInput(
  partial: Partial<CreateEntryInput> & Pick<CreateEntryInput, 'content'>,
): CreateEntryInput {
  return {
    ...emptyEntryDetails(),
    parent_id: null,
    relation_type: null,
    target_id: null,
    title: null,
    anchors: [],
    revision_mode: null,
    base_version_id: null,
    authoring_trace: null,
    media_refs: [],
    metadata: {},
    ...partial,
  }
}

/** Total order every list and fold uses, tied on id (ENTRY_MODEL.md, "Fields"). */
export function compareEntries(a: Entry, b: Entry): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}
