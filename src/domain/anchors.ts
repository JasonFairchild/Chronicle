// Anchors, read out of the document that owns them.
//
// An anchor's position is a fact about the **parent's** document, so that is where it is stored: a
// span op is a mark on the parent's text carrying `{ anchorId, kind }`, and a collapsed op is
// wording: text carrying an `anchorWording` mark with `{ anchorId }`. A related entry keeps only the
// ids (ENTRY_MODEL.md, "Related entries and anchors").
//
// So there is no stored offset to reinterpret and nothing to resolve positionally: the editor
// maintains anchor positions the way it maintains everything else, and this module only reads the
// structure back out. Nothing here imports TipTap; it walks the same plain JSON `entryDocument.ts`
// does.

import type { AnchorKind, DocumentAnchor, NarrativeRelation } from '@/types/entry'

import {
  ANCHOR_MARK,
  ANCHOR_WORDING_MARK,
  type EntryDocument,
  parseDocument,
  walk,
} from './entryDocument'

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

    const created: DocumentAnchor = { anchor_id: anchorId, kind: null, passage: '', wording: null }
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
        // passage accumulates rather than being assigned.
        anchor.passage += node.text ?? ''
        anchor.kind = anchorKind(mark.attrs) ?? anchor.kind
      } else {
        anchor.wording = (anchor.wording ?? '') + (node.text ?? '')
      }
    }
  })

  return [...anchors.values()]
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
): DocumentAnchor[] {
  const sealed = new Set(collectAnchors(base).map((anchor) => anchor.anchor_id))
  return collectAnchors(current).filter((anchor) => !sealed.has(anchor.anchor_id))
}

/**
 * Whether a related entry reads as an annotation or an update, judged by what it did to its parent
 * rather than asked of the writer. Leaving the parent's wording alone and saying something about it
 * claims nothing changed — an annotation. Striking wording or proposing different wording reports a
 * correction, which is what an update is.
 */
export function relationTypeForAnchors(anchors: DocumentAnchor[]): NarrativeRelation {
  const corrects = anchors.some((anchor) => anchor.kind === 'strike' || anchor.wording !== null)
  return corrects ? 'update' : 'annotation'
}
