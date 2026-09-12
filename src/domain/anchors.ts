/**
 * Anchors, read out of the document that owns them.
 *
 * An anchor's position is a fact about the **parent's** document, so that is where it is stored: a
 * span op is a mark on the parent's text carrying `{ anchorId, kind }`, and a collapsed op is an
 * `anchorInsert` node carrying `{ anchorId, text }`. A child entry keeps only ids and the wording
 * each one covered when it was sealed.
 *
 * That is what deletes the old resolution ladder. There is no "where did this offset end up"
 * question left to answer — the editor maintains anchor positions the same way it maintains
 * everything else — so this module only reads structure back out. Nothing here imports TipTap; it
 * walks the same plain JSON `entryDocument.ts` does.
 */

import type { AnchorKind, AnchorRef, NarrativeRelation, ResolvedAnchor } from '@/types/entry'
import {
  parseDocument,
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  type DocNode,
  type EntryDocument,
} from './entryDocument'

/** One anchor as the parent's document currently holds it. */
export interface DocumentAnchor {
  anchor_id: string
  /** From the mark. Null for an anchor that is only an `anchorInsert` node — a bare insertion. */
  kind: AnchorKind | null
  /** The text the mark covers. Empty when the anchor has no span. */
  quote: string
  /** Wording carried by an `anchorInsert` node. Null when the anchor has none. */
  insertion: string | null
}

/**
 * A fresh anchor id. Time ordering buys nothing here — an anchor is found by id, never sorted by
 * one — so this is a plain v4 rather than the UUIDv7 entries need.
 */
export function newAnchorId(): string {
  return crypto.randomUUID()
}

/**
 * Every anchor in a document, in the order its marks and nodes appear.
 *
 * A mark and a node sharing one id fold into a single anchor, which is what makes a strike and its
 * replacement wording one gesture rather than two things a renderer has to guess belong together.
 */
export function collectAnchors(content: string | EntryDocument): DocumentAnchor[] {
  const anchors = new Map<string, DocumentAnchor>()

  const upsert = (anchorId: string): DocumentAnchor => {
    const existing = anchors.get(anchorId)
    if (existing) return existing

    const created: DocumentAnchor = { anchor_id: anchorId, kind: null, quote: '', insertion: null }
    anchors.set(anchorId, created)
    return created
  }

  walk(parseDocument(content), (node) => {
    if (node.type === ANCHOR_INSERT_NODE) {
      const anchorId = attrString(node.attrs, 'anchorId')
      if (!anchorId) return

      const anchor = upsert(anchorId)
      anchor.insertion = attrString(node.attrs, 'text') ?? ''
      return
    }

    if (node.type !== 'text') return

    for (const mark of node.marks ?? []) {
      if (mark.type !== ANCHOR_MARK) continue

      const anchorId = attrString(mark.attrs, 'anchorId')
      if (!anchorId) continue

      const anchor = upsert(anchorId)
      // A mark can be split across several text nodes by any other mark overlapping it, so the
      // quote accumulates rather than being assigned.
      anchor.quote += node.text ?? ''
      anchor.kind = anchorKind(mark.attrs) ?? anchor.kind
    }
  })

  return [...anchors.values()]
}

/** The ids a document currently carries, for telling what a session added. */
export function anchorIdsIn(content: string | EntryDocument): string[] {
  return collectAnchors(content).map((anchor) => anchor.anchor_id)
}

/**
 * Anchors present in `after` but not in `before`: exactly what the session being sealed placed.
 *
 * Derived rather than tallied as the user works, so undoing an anchor removes it from the list for
 * free — there is no second record of what was placed to keep in step with the document.
 */
export function addedAnchorIds(
  before: string | EntryDocument,
  after: string | EntryDocument,
): string[] {
  const existing = new Set(anchorIdsIn(before))
  return anchorIdsIn(after).filter((anchorId) => !existing.has(anchorId))
}

/**
 * What a child entry stores for the anchors it just placed: the ids, plus the wording each one
 * covers at this moment.
 */
export function anchorRefsFor(anchorIds: string[], content: string | EntryDocument): AnchorRef[] {
  return placedAnchors(anchorIds, content).map((anchor) => ({
    anchor_id: anchor.anchor_id,
    quote: anchor.quote,
  }))
}

/**
 * Whether a child reads as an annotation or an update, judged by what it did to its parent rather
 * than asked of the writer. Leaving the parent's wording alone and saying something about it claims
 * nothing changed — an annotation. Striking wording or proposing different wording reports a
 * correction, which is what an update is. A note with no anchors at all has nothing to go on and is
 * an annotation, the quieter of the two claims.
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
 * Reads a child's anchors out of the parent's document as it stands now.
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
 * Drops anything in a stored `anchors` column that is not an anchor reference.
 *
 * Rows written before anchors moved into the parent's document hold the old op shape, which has no
 * id to look up and no mark to find. They are read as no anchors at all rather than being migrated:
 * the notes themselves are untouched, and nothing can be reconstructed from offsets measured
 * against a ruler this model no longer keeps.
 */
export function readAnchorRefs(value: unknown): AnchorRef[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is AnchorRef => {
    if (typeof item !== 'object' || item === null) return false
    const candidate = item as Partial<AnchorRef>
    return typeof candidate.anchor_id === 'string' && typeof candidate.quote === 'string'
  })
}

function anchorKind(attrs: Record<string, unknown> | undefined): AnchorKind | null {
  const kind = attrString(attrs, 'kind')
  return kind === 'comment' || kind === 'strike' ? kind : null
}

function attrString(attrs: Record<string, unknown> | undefined, name: string): string | null {
  const value = attrs?.[name]
  return typeof value === 'string' && value ? value : null
}

function walk(node: DocNode, visit: (node: DocNode) => void): void {
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}
