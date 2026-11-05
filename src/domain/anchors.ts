// Anchors, read out of the document that owns them.
//
// An anchor's position is a fact about the **parent's** document, so that is where it is stored: a
// span op is a mark on the parent's text carrying `{ anchorId, kind }`, and a collapsed op is
// wording: text carrying an `anchorWording` mark with `{ anchorId }`. A related entry keeps only ids
// and the wording each one covered when it was sealed (ENTRY_MODEL.md, "Related entries and
// anchors").
//
// So there is no stored offset to reinterpret and nothing to resolve positionally: the editor
// maintains anchor positions the way it maintains everything else, and this module only reads the
// structure back out. Nothing here imports TipTap; it walks the same plain JSON `entryDocument.ts`
// does.

import type { AnchorKind, AnchorRef, NarrativeRelation, ResolvedAnchor } from '@/types/entry'

import {
  ANCHOR_MARK,
  ANCHOR_WORDING_MARK,
  type EntryDocument,
  parseDocument,
  walk,
} from './entryDocument'

/** One anchor as the parent's document currently holds it. */
export interface DocumentAnchor {
  anchor_id: string
  /** From the mark. Null for an anchor that is only wording — a bare insertion. */
  kind: AnchorKind | null
  /** The text the mark covers. Empty when the anchor has no span. */
  quote: string
  /** The anchor's wording as written, spaces included. Null when it has none. */
  insertion: string | null
}

/**
 * A fresh anchor id. Time ordering buys nothing here — an anchor is found by id, never sorted by
 * one — so this is a plain v4 rather than the UUIDv7 entries need.
 */
export function newAnchorId(): string {
  return crypto.randomUUID()
}

function attrString(attrs: Record<string, unknown> | undefined, name: string): string | null {
  const value = attrs?.[name]
  return typeof value === 'string' && value ? value : null
}

function anchorKind(attrs: Record<string, unknown> | undefined): AnchorKind | null {
  const kind = attrString(attrs, 'kind')
  return kind === 'comment' || kind === 'strike' ? kind : null
}

/**
 * Every anchor in a document, in the order its passages and wording appear.
 *
 * A passage and wording sharing one id fold into a single anchor, which is what makes a strike and
 * its replacement wording one gesture rather than two things a renderer has to guess belong
 * together.
 */
export function collectAnchors(content: string | EntryDocument): DocumentAnchor[] {
  const doc = parseDocument(content)
  const anchors = new Map<string, DocumentAnchor>()

  const upsert = (anchorId: string): DocumentAnchor => {
    const existing = anchors.get(anchorId)
    if (existing) return existing

    const created: DocumentAnchor = { anchor_id: anchorId, kind: null, quote: '', insertion: null }
    anchors.set(anchorId, created)
    return created
  }

  walk(doc, (node) => {
    if (node.type !== 'text') return

    for (const mark of node.marks ?? []) {
      if (mark.type !== ANCHOR_MARK && mark.type !== ANCHOR_WORDING_MARK) continue

      const anchorId = attrString(mark.attrs, 'anchorId')
      if (!anchorId) continue

      const anchor = upsert(anchorId)
      if (mark.type === ANCHOR_MARK) {
        // A mark can be split across several text nodes by any other mark overlapping it, so the
        // quote accumulates rather than being assigned.
        anchor.quote += node.text ?? ''
        anchor.kind = anchorKind(mark.attrs) ?? anchor.kind
      } else {
        anchor.insertion = (anchor.insertion ?? '') + (node.text ?? '')
      }
    }
  })

  return [...anchors.values()]
}

/** The ids a document currently carries, for telling what a session added. */
function anchorIdsIn(content: string | EntryDocument): string[] {
  return collectAnchors(content).map((anchor) => anchor.anchor_id)
}

/**
 * The anchors placed in `current` since `base`: everything present that the base didn't carry.
 * Derived rather than tallied as the user works, so undoing an anchor drops it from this list for
 * free — there is no second record of what was placed to keep in step with the document.
 *
 * A session's base is named (`Draft.parent.base_version_id`) rather than inferred from whatever the
 * editor happened to mount with, which is what makes this survive a resume: a reload reseeds the
 * editor from the draft's *current* parent document, where an anchor this session placed before the
 * reload is indistinguishable from one an earlier related entry sealed. Against the base it stays
 * legible.
 */
export function anchorsPlacedSince(
  base: string | EntryDocument,
  current: string | EntryDocument,
): string[] {
  const sealed = new Set(anchorIdsIn(base))
  return anchorIdsIn(current).filter((anchorId) => !sealed.has(anchorId))
}

/**
 * The anchors a session placed, as the document holds them. Ids the document does not carry are
 * skipped — nothing should record a reference to an anchor that was undone before sealing.
 */
function placedAnchors(anchorIds: string[], content: string | EntryDocument): DocumentAnchor[] {
  const present = new Map(collectAnchors(content).map((anchor) => [anchor.anchor_id, anchor]))

  return anchorIds.flatMap((anchorId) => {
    const anchor = present.get(anchorId)
    return anchor ? [anchor] : []
  })
}

/**
 * What a related entry stores for the anchors it just placed: the ids, plus the wording each one
 * covers at this moment.
 */
export function anchorRefsFor(anchorIds: string[], content: string | EntryDocument): AnchorRef[] {
  return placedAnchors(anchorIds, content).map((anchor) => ({
    anchor_id: anchor.anchor_id,
    quote: anchor.quote,
  }))
}

/**
 * Whether a related entry reads as an annotation or an update, judged by what it did to its parent
 * rather than asked of the writer. Leaving the parent's wording alone and saying something about it
 * claims nothing changed — an annotation. Striking wording or proposing different wording reports a
 * correction, which is what an update is. One with no anchors at all has nothing to go on and is an
 * annotation, the quieter of the two claims.
 */
export function relationTypeForAnchors(
  anchorIds: string[],
  content: string | EntryDocument,
): NarrativeRelation {
  const corrects = placedAnchors(anchorIds, content).some(
    (anchor) => anchor.kind === 'strike' || anchor.insertion !== null,
  )

  return corrects ? 'update' : 'annotation'
}

/**
 * Reads a related entry's anchors out of the parent's document as it stands now.
 *
 * An anchor whose mark a later revision deleted is not dropped: it comes back orphaned, carrying
 * the quote recorded at seal time, so breakage renders as legible history rather than silent loss.
 */
export function resolveAnchors(
  refs: AnchorRef[],
  content: string | EntryDocument,
): ResolvedAnchor[] {
  const present = new Map(collectAnchors(content).map((anchor) => [anchor.anchor_id, anchor]))

  return refs.map((ref) => {
    const anchor = present.get(ref.anchor_id)

    if (!anchor) {
      return {
        anchor_id: ref.anchor_id,
        status: 'orphaned',
        quote: ref.quote,
        kind: null,
        insertion: null,
      }
    }

    return {
      anchor_id: ref.anchor_id,
      status: 'present',
      // The document is the authority on what the anchor covers today; the stored quote is only
      // the fallback for when it no longer covers anything.
      quote: anchor.quote,
      kind: anchor.kind,
      insertion: anchor.insertion,
    }
  })
}

/**
 * One anchor's extent, in ProseMirror positions (`anchorSpans`, `editor/anchorCommands.ts`), kept
 * as plain numbers so the judgments below stay pure and node-testable.
 */
export interface AnchorRange {
  anchor_id: string
  from: number
  to: number
}

/**
 * The first of `ranges` that overlaps `[from, to)` at all, or null when none does — what keeps
 * anchors exclusive: `markAnchor` (`editor/anchorCommands.ts`) refuses to place a new one wherever
 * this finds a hit, whether that range is this session's own or an earlier related entry's sealed
 * one. Two ranges that only touch, sharing an endpoint with no space between, are not overlapping.
 */
export function anchorRangeOverlapping<T extends AnchorRange>(
  ranges: T[],
  from: number,
  to: number,
): T | null {
  return ranges.find((range) => range.from < to && from < range.to) ?? null
}
