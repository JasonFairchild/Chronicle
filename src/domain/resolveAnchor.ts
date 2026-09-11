import type { AnchorOp, DocLocation, ResolvedOp } from '@/types/entry'

/**
 * Relocates a position from the version it was recorded against into the current one.
 *
 * When authoring steps exist, this is backed by a ProseMirror `Mapping`, which moves a position
 * exactly rather than guessing. It is injected rather than imported so this module stays pure and
 * testable outside a browser. Return `null` when the position cannot be mapped.
 */
export type PositionMapper = (position: number, baseVersionId: string | null) => number | null

export interface ResolveContext {
  /** The parent's text as it stands at the moment being viewed. */
  text: string
  /** The parent's media refs, used by `media` ops. */
  mediaRefs?: string[]
  /** Supplied when step history is available for the parent. */
  mapPosition?: PositionMapper
}

/** How much surrounding text to keep so a repeated quote can be told apart later. */
const CONTEXT_LENGTH = 32

/**
 * Captures a location from a selection, recording the version it was measured in along with enough
 * surrounding text to find it again after the parent changes.
 *
 * A collapsed selection produces an insertion point: the quote is empty and the context is all the
 * evidence there is, which is why both sides are always stored.
 */
export function createDocLocation(
  text: string,
  from: number,
  to: number,
  baseVersionId: string | null,
): DocLocation {
  const start = Math.max(0, Math.min(from, to))
  const end = Math.min(text.length, Math.max(from, to))

  return {
    from: start,
    to: end,
    base_version_id: baseVersionId,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  }
}

/**
 * Locates one anchored operation in the parent's current text.
 *
 * The ladder is deliberate: trust recorded positions, then trust recorded steps, then fall back to
 * searching for the quoted text, and only then give up. An orphaned op is never dropped, because
 * the quote it carries is the record of what the passage originally said.
 */
export function resolveAnchorOp(op: AnchorOp, context: ResolveContext): ResolvedOp {
  if (op.kind === 'media') {
    const present = context.mediaRefs?.includes(op.media_ref) ?? false
    return present ? { op, status: 'exact' } : { op, status: 'orphaned' }
  }

  const location = op.at
  const { text } = context

  if (stillHolds(text, location)) {
    return { op, status: 'exact', range: [location.from, location.to] }
  }

  const mapped = mapLocation(location, context)
  if (mapped && stillHolds(text, { ...location, from: mapped[0], to: mapped[1] })) {
    return { op, status: 'mapped', range: mapped }
  }

  const found = isCollapsed(location) ? findCollapsed(text, location) : findByQuote(text, location)
  if (found) {
    return { op, status: 'fuzzy', range: found }
  }

  return { op, status: 'orphaned' }
}

export function resolveAnchorOps(ops: AnchorOp[], context: ResolveContext): ResolvedOp[] {
  return ops.map((op) => resolveAnchorOp(op, context))
}

/**
 * True when a strike and an insert in the same child entry describe one replacement gesture.
 * Pairing is inferred at render time rather than stored, which is why there is no `replace` op.
 */
export function isReplacementPair(strike: ResolvedOp, insert: ResolvedOp): boolean {
  if (strike.op.kind !== 'strike' || insert.op.kind !== 'insert') return false
  if (!strike.range || !insert.range) return false

  const [strikeFrom, strikeTo] = strike.range
  const [insertAt] = insert.range

  return insertAt >= strikeFrom && insertAt <= strikeTo
}

function isCollapsed(location: DocLocation): boolean {
  return location.from === location.to
}

/**
 * Whether the recorded positions still bracket the text the anchor was made against.
 *
 * Context has to hold too, not just the quote. A phrase that appears several times would otherwise
 * report `exact` at whichever occurrence the old positions happen to land on, silently attaching
 * the note to the wrong sentence. When context has drifted, falling through to the quote search is
 * the safe outcome, because that search weighs context instead of ignoring it.
 */
function stillHolds(text: string, location: DocLocation): boolean {
  const { from, to, quote } = location
  const prefix = location.prefix ?? ''
  const suffix = location.suffix ?? ''

  if (from < 0 || to > text.length || from > to) return false

  // A collapsed location has no quote, so its surroundings are the only evidence there is.
  if (!quote && !prefix && !suffix) return false
  if (quote && text.slice(from, to) !== quote) return false

  if (prefix && !text.slice(Math.max(0, from - prefix.length), from).endsWith(prefix)) return false
  if (suffix && !text.startsWith(suffix, to)) return false

  return true
}

function mapLocation(location: DocLocation, context: ResolveContext): [number, number] | null {
  if (!context.mapPosition) return null

  const from = context.mapPosition(location.from, location.base_version_id)
  const to = context.mapPosition(location.to, location.base_version_id)
  if (from === null || to === null || from > to) return null

  return [from, to]
}

/**
 * Finds the quoted text again after positions have drifted. When a quote appears more than once,
 * the stored prefix and suffix decide which occurrence was meant.
 */
function findByQuote(text: string, location: DocLocation): [number, number] | null {
  const { quote } = location
  const prefix = location.prefix ?? ''
  const suffix = location.suffix ?? ''
  if (!quote) return null

  let best: { index: number; score: number } | null = null

  for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1)) {
    const score =
      commonSuffixLength(text.slice(0, index), prefix) +
      commonPrefixLength(text.slice(index + quote.length), suffix)

    if (!best || score > best.score) {
      best = { index, score }
    }
  }

  return best ? [best.index, best.index + quote.length] : null
}

/** An insertion point has no quote, so it is located by the text that used to surround it. */
function findCollapsed(text: string, location: DocLocation): [number, number] | null {
  const prefix = location.prefix ?? ''
  const suffix = location.suffix ?? ''

  if (prefix && suffix) {
    const joined = text.indexOf(prefix + suffix)
    if (joined !== -1) {
      const at = joined + prefix.length
      return [at, at]
    }
  }

  if (prefix) {
    const index = text.indexOf(prefix)
    if (index !== -1) {
      const at = index + prefix.length
      return [at, at]
    }
  }

  if (suffix) {
    const index = text.indexOf(suffix)
    if (index !== -1) return [index, index]
  }

  return null
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let length = 0
  while (length < max && a[length] === b[length]) length += 1
  return length
}

function commonSuffixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let length = 0
  while (length < max && a[a.length - 1 - length] === b[b.length - 1 - length]) length += 1
  return length
}
