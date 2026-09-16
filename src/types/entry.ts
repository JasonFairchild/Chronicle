/** The unified Entry model. See ENTRY_MODEL.md for the reasoning behind these shapes. */

export type NarrativeRelation = 'annotation' | 'update'
export type EdgeRelation = 'connection'
export type VersionRelation = 'revision'

/** `connection` and `revision` are structural; `annotation`/`update` are a label only. */
export type RelationType = NarrativeRelation | EdgeRelation | VersionRelation

/** What a span anchor does to the passage it covers — marks on the parent's own text. */
export type AnchorKind = 'comment' | 'strike'

/** A child's reference to an anchor living in its parent's document. */
export interface AnchorRef {
  anchor_id: string
  quote: string
}

/** Which creation experience produced a revision. */
export type RevisionMode = 'text' | 'anchor'

/** Why a moment in a writing session was bookmarked. */
export type TickReason = 'pause' | 'punctuation' | 'interval' | 'format' | 'anchor' | 'manual'

/** One serialized ProseMirror step with the moment it happened. */
export interface AuthoringStep {
  at: string
  step: unknown
}

/** A day plus freeform wording for the time within it — the shape a form or draft edits directly. */
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

/** A bookmark into the step chain, marking a moment worth stopping at when reviewing. */
export interface AuthoringTick {
  at: string
  step_index: number
  reason: TickReason
}

/** How one writing session produced its snapshot. */
export interface AuthoringTrace {
  session_id: string
  started_at: string
  ended_at: string
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
}

export interface Entry {
  /** UUIDv7 — sortable as text; ties in `created_at` resolve via id, see `compareEntries`. */
  id: string
  /** System-set, immutable. */
  created_at: string
  recorded_at: string | null
  recorded_time_note: string | null
  occurred_at: string | null
  occurred_time_note: string | null
  parent_id: string | null
  relation_type: RelationType | null
  /** Connections only. */
  target_id: string | null
  /** Cache of the document's title node. */
  title: string | null
  content: string
  /** Empty means the entry is about its parent at large. */
  anchors: AnchorRef[]
  /** Revisions only. */
  revision_mode: RevisionMode | null
  authoring_trace: AuthoringTrace | null
  /** Blob ids in the media store. */
  media_refs: string[]
  /** Only what neither drives domain logic nor gets queried. See ENTRY_MODEL.md. */
  metadata: Record<string, unknown>
}

export type CreateEntryInput = Omit<Entry, 'id' | 'created_at'>

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

/** One link in an entry's version chain. Version one has a null `revision_id`. */
export interface EntryVersion {
  revision_id: string | null
  at: string
  content: string
  media_refs: string[]
  metadata: Record<string, unknown>
}

/** The same chain read through one field: what the entry was called, and when. */
export interface TitleVersion {
  revision_id: string | null
  at: string
  title: string | null
}

export interface ResolvedChild {
  entry: AggregatedEntry
  relation_type: RelationType
  /** This child's anchors, read out of the parent's current document. */
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

/** An entry's own state at a point in time, plus its relations as collections. */
export interface AggregatedEntry {
  id: string
  created_at: string
  /** Null for a root entry. */
  parent_id: string | null
  relation_type: RelationType | null
  /** Connections only. */
  target_id: string | null
  /** Read from the entry's own row, not the version chain — a revision carries no dates. */
  dates: EntryDates
  title: string | null
  /** This entry's own text at the requested time. */
  content: string
  media_refs: string[]
  metadata: Record<string, unknown>
  version: { index: number; total: number; at: string; revision_id: string | null }
  children: ResolvedChild[]
  connections: ResolvedConnection[]
}

export function createEntryInput(
  partial: Partial<CreateEntryInput> & Pick<CreateEntryInput, 'content'>,
): CreateEntryInput {
  return {
    ...emptyEntryDates(),
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

/** The counter occupies 12 bits, so this is the last value that still encodes faithfully. */
const MAX_SAME_MS_COUNTER = 0x0fff

/**
 * UUIDv7, not v4 (ENTRY_MODEL.md) — sortable as plain text since the millisecond timestamp leads.
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
  // RFC 9562 variant bits.
  bytes[8] = (bytes[8] & 0x3f) | 0x80

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
