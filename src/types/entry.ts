/**
 * The unified Entry model. See ENTRY_MODEL.md for the reasoning behind these shapes.
 *
 * Two invariants govern everything here:
 *  - No child entry is ever destructive. A parent's stored text is never altered by its children.
 *  - Only the version family (`revision`) writes content.
 */

/** Children that say something about a parent. Identical to the fold; the split is a UI label. */
export type NarrativeRelation = 'annotation' | 'update'

/** An edge between two entries. Gathered onto both endpoints, never traversed as containment. */
export type EdgeRelation = 'connection'

/** A new version of the entry itself. The only relation that writes content. */
export type VersionRelation = 'revision'

/**
 * `connection` and `revision` are structural: they change how the domain layer treats an entry.
 * `annotation` and `update` are a label. They drive icons, defaults, and filtering, and are
 * deliberately identical to the fold.
 */
export type RelationType = NarrativeRelation | EdgeRelation | VersionRelation

/**
 * What a span anchor does to the passage it covers. Both are marks on the parent's own text.
 *
 * There is deliberately no `replace`: since nothing hides the parent's text, "I'd have written this
 * differently" is a `strike` whose replacement wording rides along as an `anchorInsert` node
 * sharing its `anchor_id`.
 */
export type AnchorKind = 'comment' | 'strike'

/**
 * A child's reference to an anchor that lives in its **parent's** document.
 *
 * ENTRY_MODEL.md describes this as `anchor_ids` plus one `quote` captured at seal time. It is one
 * array of pairs rather than two parallel arrays for the obvious reason: parallel arrays can drift
 * out of step and this cannot. The quote is not a growing history — the parent's own step chain is
 * that — it is what lets an anchor whose mark a later revision deleted still say what it was
 * attached to, once nothing in the current document carries its id.
 */
export interface AnchorRef {
  anchor_id: string
  /** The parent's wording under the anchor when the child was sealed. */
  quote: string
}

/**
 * Which of the two creation experiences produced a revision. Not `metadata`, because it is
 * filtered on: a card's revision count reads `'text'` revisions only, so the revisions that merely
 * carry someone else's annotation never inflate it.
 */
export type RevisionMode = 'text' | 'anchor'

/** Why a moment was bookmarked while writing. Ticks are navigation aids, never saves. */
export type TickReason = 'pause' | 'punctuation' | 'interval' | 'format' | 'manual'

/** One serialized ProseMirror step with the moment it happened. */
export interface AuthoringStep {
  at: string
  step: unknown
}

/** A bookmark into the step chain, marking a state worth stopping at when reviewing. */
export interface AuthoringTick {
  at: string
  step_index: number
  reason: TickReason
}

/** How one snapshot came to be written. Null when typing was not captured. */
export interface AuthoringTrace {
  session_id: string
  started_at: string
  ended_at: string
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
}

export interface Entry {
  /** UUIDv7: time-ordered and sortable as text, so `created_at` ties resolve deterministically. */
  id: string
  /** When the entry entered Chronicle. System-set and immutable. */
  created_at: string
  /** When the record was originally recorded elsewhere. Null if authored in-app. */
  recorded_at?: string | null
  /** When the event being recorded actually happened, if known. */
  occurred_at?: string | null
  parent_id: string | null
  relation_type: RelationType | null
  /** The far endpoint. Connections only. */
  target_id: string | null
  /** Cache of the document's title node. Never edited on its own. */
  title: string | null
  /** Serialized document. */
  content: string
  /** Anchors in the parent's document. Empty means the entry is about its parent at large. */
  anchors: AnchorRef[]
  /** Revisions only: which creation experience wrote this version. Null for everything else. */
  revision_mode: RevisionMode | null
  authoring_trace: AuthoringTrace | null
  /** Blob ids in the media store that this document depends on. */
  media_refs: string[]
  /** Only what neither drives domain logic nor gets queried. See ENTRY_MODEL.md. */
  metadata: Record<string, unknown>
}

export type CreateEntryInput = Omit<Entry, 'id' | 'created_at'>

/**
 * Whether the parent's document still carries this anchor. There is no ladder of degrees any more:
 * an anchor is a mark in the document being read, so either its id is there or it is not.
 */
export type AnchorStatus = 'present' | 'orphaned'

export interface ResolvedAnchor {
  anchor_id: string
  status: AnchorStatus
  /** What the anchor covers now, or the wording recorded at seal time once it is orphaned. */
  quote: string
  /** Null when the anchor is orphaned, or when it is a bare insertion with no span to mark. */
  kind: AnchorKind | null
  /** Wording the anchor carries in the parent's document. Null when it has none. */
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
  label: string | null
}

/**
 * An entry's own state at a point in time, plus its relations as collections.
 * Children are never concatenated into `content`: that would make anchoring impossible and
 * would make `content` untrue for any given moment.
 */
export interface AggregatedEntry {
  id: string
  created_at: string
  title: string | null
  /** This entry's OWN text at the requested time. */
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
 * A UUIDv7: a 48-bit millisecond timestamp in the leading bits, then a 12-bit counter, then
 * randomness. Ids therefore sort correctly as plain text, and two entries created in the same
 * millisecond still come back in the order they were made.
 *
 * `crypto.randomUUID()` only emits v4, whose random ordering would make history unreconstructible.
 *
 * The timestamp used is a floor rather than a straight clock read. `compareEntries` leans on ids
 * for its tiebreak, so an id that sorts before one already issued would corrupt the fold — and both
 * a backwards clock adjustment and a counter overflow would produce exactly that. Borrowing a
 * millisecond from the future costs nothing and keeps the sequence monotonic through either.
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

/**
 * The total order every list and fold uses. `created_at` alone is only millisecond-resolution,
 * so the id breaks ties; because ids are UUIDv7 that tiebreak matches creation order.
 */
export function compareEntries(a: Entry, b: Entry): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}
