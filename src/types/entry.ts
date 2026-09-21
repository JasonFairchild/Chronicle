/** The unified Entry model. See ENTRY_MODEL.md for the reasoning behind these shapes. */

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

export type TickReason =
  | 'pause'
  | 'paste'
  | 'media'
  | 'deletion'
  | 'punctuation'
  | 'interval'
  | 'format'
  | 'anchor'
  | 'manual'

/**
 * A bookmark into the step chain, marking a moment worth stopping at when reviewing. A tick fires
 * when at least one reason applies, and it can be several at once — a sentence finished right after
 * a long pause is both — so `reasons` is ordered by priority rather than picking just one; a scrub
 * UI showing one label reads `reasons[0]`.
 */
export interface AuthoringTick {
  /** Milliseconds since the trace's `started_at` — see `AuthoringStep.at`. */
  at: number
  step_index: number
  reasons: [TickReason, ...TickReason[]]
}

/**
 * One serialized ProseMirror step with the moment it happened.
 *
 * `at` is milliseconds since the trace's `started_at`, not a timestamp of its own — `started_at`
 * survives a reload while a clock does not reliably, so ordering by `step_index` is the total
 * order; a clock adjustment between sessions could otherwise put two `at` values out of sequence.
 */
export interface AuthoringStep {
  at: number
  step: unknown
}

/** How one writing session produced its snapshot. */
export interface AuthoringTrace {
  session_id: string
  started_at: string
  ended_at: string
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
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
  location: string | null // A name the author reuses, not coordinates.
  original_medium: string | null // Where it was first written, for imports and recreations.
  original_medium_note: string | null
  title: string | null
  content: string
  media_refs: string[] // Blob ids in the media store.
  metadata: Record<string, unknown> // Only what neither drives domain logic nor gets queried.
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
  id: string // UUIDv7 — sortable as text.
  created_at: string // System-set, immutable.
  parent_id: string | null
  relation_type: RelationType | null
  target_id: string | null // Connections only.
  anchors: AnchorRef[] // Empty means the entry is about its parent at large.
  revision_mode: RevisionMode | null // Revisions only.
  authoring_trace: AuthoringTrace | null
}

// From here down: shapes derived from or about Entry, not one of its own field types.

export type AnchorKind = 'comment' | 'strike'

/** Whether the parent's document still carries this anchor. */
export type AnchorStatus = 'present' | 'orphaned'

export interface ResolvedAnchor {
  anchor_id: string
  status: AnchorStatus
  quote: string // Current wording if present, the sealed quote if orphaned.
  kind: AnchorKind | null // Null when orphaned or a bare insertion.
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

export interface ResolvedChild {
  entry: AggregatedEntry
  relation_type: RelationType
  anchors: ResolvedAnchor[] // This child's anchors, read out of the parent's current document.
  has_children: boolean // Grandchildren are indicated, not expanded.
}

export interface ResolvedConnection {
  entry: AggregatedEntry
  other_id: string // The endpoint that is not the entry being viewed.
  direction: 'outgoing' | 'incoming'
}

/**
 * An entry's own state at a point in time, plus its relations as collections. The inherited
 * fields are the newest applicable revision's, not necessarily the entry's own row.
 */
export interface AggregatedEntry extends VersionedFields {
  id: string
  created_at: string
  parent_id: string | null // Null for a root entry.
  relation_type: RelationType | null
  target_id: string | null // Connections only.
  version: { index: number; total: number; at: string; revision_id: string | null }
  children: ResolvedChild[]
  connections: ResolvedConnection[]
}

export type CreateEntryInput = Omit<Entry, 'id' | 'created_at'>

export function createEntryInput(
  partial: Partial<CreateEntryInput> & Pick<CreateEntryInput, 'content'>,
): CreateEntryInput {
  return {
    dates: emptyEntryDates(),
    location: null,
    original_medium: null,
    original_medium_note: null,
    parent_id: null,
    relation_type: null,
    target_id: null,
    title: null,
    anchors: [],
    revision_mode: null,
    authoring_trace: null,
    media_refs: [],
    metadata: {},
    ...partial,
  }
}

/** Which millisecond an id lands in, and its place within that millisecond. */
export interface IdClock {
  ms: number
  counter: number
}

/**
 * Advances the clock by one id. The millisecond is a floor, not a straight clock read:
 * `compareEntries` ties on id, so a backwards clock adjustment or a counter overflow must never
 * emit an id that sorts before one already issued.
 */
export function advanceIdClock(previous: IdClock, now: number): IdClock {
  const maxCounter = 0x0fff // 12 bits — the widest value the UUIDv7 rand_a field can hold.

  if (now > previous.ms) return { ms: now, counter: 0 }
  if (previous.counter >= maxCounter) return { ms: previous.ms + 1, counter: 0 }

  return { ms: previous.ms, counter: previous.counter + 1 }
}

let idClock: IdClock = { ms: -1, counter: 0 } // -1 sorts before any real timestamp.

/** UUIDv7, not v4 — sortable as plain text since the millisecond timestamp leads. */
export function newEntryId(): string {
  idClock = advanceIdClock(idClock, Date.now())

  const { ms: timestamp, counter } = idClock
  const bytes = crypto.getRandomValues(new Uint8Array(16))

  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff
  bytes[5] = timestamp & 0xff

  // Version 7 in the high nibble, then the counter across the remaining 12 bits.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f)
  bytes[7] = counter & 0xff
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 9562 variant bits.

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export function newEntryTimestamp(): string {
  return new Date().toISOString()
}

/** Total order every list and fold uses. See CLAUDE.md, "Ordering". */
export function compareEntries(a: Entry, b: Entry): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}
