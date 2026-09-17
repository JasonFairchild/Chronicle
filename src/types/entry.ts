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

export type TickReason = 'pause' | 'punctuation' | 'interval' | 'format' | 'anchor' | 'manual'

/** A bookmark into the step chain, marking a moment worth stopping at when reviewing. */
export interface AuthoringTick {
  at: string
  step_index: number
  reason: TickReason
}

/** One serialized ProseMirror step with the moment it happened. */
export interface AuthoringStep {
  at: string
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

export interface Entry {
  id: string // UUIDv7 — sortable as text.
  created_at: string // System-set, immutable.
  dates: EntryDates
  location: string | null // A name the author reuses, not coordinates.
  original_medium: string | null // Where it was first written, for imports and recreations.
  original_medium_note: string | null
  parent_id: string | null
  relation_type: RelationType | null
  target_id: string | null // Connections only.
  title: string | null
  content: string
  anchors: AnchorRef[] // Empty means the entry is about its parent at large.
  revision_mode: RevisionMode | null // Revisions only.
  authoring_trace: AuthoringTrace | null
  media_refs: string[] // Blob ids in the media store.
  metadata: Record<string, unknown> // Only what neither drives domain logic nor gets queried.
}

/** From here down: shapes derived from or about Entry, not one of its own field types. */

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
export interface EntryVersion {
  revision_id: string | null
  at: string
  content: string
  media_refs: string[]
  metadata: Record<string, unknown>
  dates: EntryDates
  location: string | null
  original_medium: string | null
  original_medium_note: string | null
  title: string | null
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

/** An entry's own state at a point in time, plus its relations as collections. */
export interface AggregatedEntry {
  id: string
  created_at: string
  parent_id: string | null // Null for a root entry.
  relation_type: RelationType | null
  target_id: string | null // Connections only.
  // Folded through the version chain like content, so the newest revision at `asOf` wins.
  dates: EntryDates
  location: string | null
  original_medium: string | null
  original_medium_note: string | null
  title: string | null
  content: string // This entry's own text at the requested time.
  media_refs: string[]
  metadata: Record<string, unknown>
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

let lastTimestampMs = -1
let sameMsCounter = 0

// The counter occupies 12 bits, so this is the last value that still encodes faithfully.
const MAX_SAME_MS_COUNTER = 0x0fff

/**
 * UUIDv7, not v4 — sortable as plain text since the millisecond timestamp leads.
 * The timestamp is a floor, not a straight clock read: `compareEntries` ties on id, so a backwards
 * clock adjustment or a counter overflow must never emit an id that sorts before one already issued.
 */
export function newEntryId(): string {
  const ms = Math.max(Date.now(), lastTimestampMs)

  if (ms === lastTimestampMs) {
    sameMsCounter += 1

    if (sameMsCounter > MAX_SAME_MS_COUNTER) {
      lastTimestampMs += 1
      sameMsCounter = 0
    }
  } else {
    lastTimestampMs = ms
    sameMsCounter = 0
  }

  const timestamp = lastTimestampMs
  const bytes = crypto.getRandomValues(new Uint8Array(16))

  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff
  bytes[5] = timestamp & 0xff

  // Version 7 in the high nibble, then the counter across the remaining 12 bits.
  bytes[6] = 0x70 | ((sameMsCounter >> 8) & 0x0f)
  bytes[7] = sameMsCounter & 0xff
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
