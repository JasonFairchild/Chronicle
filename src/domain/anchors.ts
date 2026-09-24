/**
 * Anchors, read out of the document that owns them.
 *
 * An anchor's position is a fact about the **parent's** document, so that is where it is stored: a
 * span op is a mark on the parent's text carrying `{ anchorId, kind }`, and a collapsed op is an
 * `anchorInsert` node carrying `{ anchorId, text }`. A child entry keeps only ids and the wording
 * each one covered when it was sealed (ENTRY_MODEL.md, "Child entries and anchors").
 *
 * So there is no stored offset to reinterpret and nothing to resolve positionally: the editor
 * maintains anchor positions the way it maintains everything else, and this module only reads the
 * structure back out. Nothing here imports TipTap; it walks the same plain JSON `entryDocument.ts`
 * does.
 */

import type { AnchorKind, AnchorRef, NarrativeRelation, ResolvedAnchor } from '@/types/entry'
import {
  parseDocument,
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  type DocMark,
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
      // Empty text reads as no insertion at all — the node an eagerly-opened, still-empty wording
      // session leaves behind (`addAnchorMark`) must not read as a correction nobody wrote.
      anchor.insertion = attrString(node.attrs, 'text')
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
 * The anchor id that wording typed at a caret should pair with, given the marks carried by the text
 * immediately before it — `$from.nodeBefore`'s marks, in `anchorCommands.ts`'s terms — or null when
 * there is nothing to pair with.
 *
 * Only an anchor placed **this session** may absorb it: a sealed anchor from an earlier child sits in
 * the same document, and pairing with one would attach this entry's wording to another entry's
 * anchor. `sealed` is that earlier child's ids — the ones the session's base document already
 * carried, computed once when the editor mounts — which is what makes this pure and node-testable,
 * and what makes highlight-plus-inline-wording work for free.
 */
export function pairableAnchorAt(
  marksBefore: DocMark[],
  sealed: ReadonlySet<string>,
): string | null {
  for (const mark of marksBefore) {
    if (mark.type !== ANCHOR_MARK) continue
    const anchorId = attrString(mark.attrs, 'anchorId')
    if (anchorId && !sealed.has(anchorId)) return anchorId
  }

  return null
}

/**
 * The anchors this session has placed, read off the document as it stands right now: everything
 * present that isn't sealed. Derived rather than tallied as the user works, so undoing an anchor
 * drops it from this list for free — there is no second record of what was placed to keep in step
 * with the document.
 *
 * `sealed` is the ids the document already carried when the session began — `anchorIdsIn` of its
 * base (`Draft.parent.base_content`). Taking it as a set rather than a document is what lets the
 * editor compute it once, at mount, and answer "may I still edit this one?" per keystroke.
 */
export function sessionAnchorIds(
  sealed: ReadonlySet<string>,
  content: string | EntryDocument,
): string[] {
  return anchorIdsIn(content).filter((anchorId) => !sealed.has(anchorId))
}

/**
 * The anchors placed in `current` since `base` — the same question `sessionAnchorIds` answers, asked
 * of two documents rather than a precomputed set, for callers holding the session's base document.
 *
 * A session's base is persisted (`Draft.parent.base_content`) rather than inferred from whatever the
 * editor happened to mount with, which is what makes this survive a resume: a reload reseeds the
 * editor from the draft's *current* parent document, where an anchor this session placed before the
 * reload is indistinguishable from one an earlier child sealed. Against the base it stays legible.
 */
export function anchorsPlacedSince(
  base: string | EntryDocument | null,
  current: string | EntryDocument | null,
): string[] {
  // Nullable because a non-`new_child` target's `Draft.parent` is null — no parent document at all
  // means no anchors placed on one, rather than an error worth raising.
  if (!current) return []
  return sessionAnchorIds(new Set(base ? anchorIdsIn(base) : []), current)
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
 * One anchor's mark extent, in whatever positional units the caller measures in — ProseMirror
 * document positions for every caller today (`editor/anchorCommands.ts`'s `anchorMarkRanges` /
 * `editableAnchorRanges`), kept as plain numbers here the same way `PositionRange`
 * (`anchorWarnings.ts`) is, so the judgment below stays pure and node-testable.
 */
export interface AnchorRange {
  anchor_id: string
  from: number
  to: number
}

/**
 * The smallest range containing `pos`, among possibly several that overlap — a click inside an
 * anchor placed over part of an earlier one should resolve to the inner, more specific anchor.
 * Null when nothing covers `pos` at all.
 */
export function innermostAnchorAt<T extends AnchorRange>(ranges: T[], pos: number): T | null {
  let best: T | null = null

  for (const range of ranges) {
    if (pos < range.from || pos > range.to) continue
    if (!best || range.to - range.from < best.to - best.from) best = range
  }

  return best
}

/**
 * The first of `ranges` that overlaps `[from, to)` at all, or null when none does — what keeps
 * anchors exclusive: `markAnchor` (`editor/anchorCommands.ts`) refuses to place a new one wherever
 * this finds a hit, whether that range is this session's own or an earlier child's already-sealed
 * one. Two ranges that only touch, sharing an endpoint with no space between, are not overlapping.
 */
export function anchorRangeOverlapping<T extends AnchorRange>(
  ranges: T[],
  from: number,
  to: number,
): T | null {
  return ranges.find((range) => range.from < to && from < range.to) ?? null
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
