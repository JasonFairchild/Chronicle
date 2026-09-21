import type { Editor } from '@tiptap/core'
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Mapping } from '@tiptap/pm/transform'
import { ref, type Ref } from 'vue'
import {
  anchorRangeOverlapping,
  collectAnchors,
  newAnchorId,
  type AnchorRange,
} from '@/domain/anchors'
import type { AnchorMapping } from '@/domain/anchorWarnings'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK, type EntryDocument } from '@/domain/entryDocument'
import type { AnchorKind } from '@/types/entry'

/**
 * The imperative half of anchor-mode: commands that place, edit, or read anchors on an editor that
 * already exists, plus the guard predicate that recognises them. `extensions.ts` is the schema
 * these operate on — a mark and a node type, and the plugin that installs the guard below into an
 * anchor-mode editor — kept separate so each file answers one question: what an anchor *is*
 * (extensions.ts) versus what a session *does* with one (here).
 */

/**
 * Marks a transaction as one of this module's anchor commands, which is what `isAnchorEdit` lets
 * through in anchor mode.
 */
const ANCHOR_EDIT_META = 'chronicleAnchorEdit'

/** prosemirror-history's own plugin key, so undo and redo are recognisable to the guard below. */
const HISTORY_META = 'history$'

/**
 * The anchor-mode guard, installed by `extensions.ts`'s `AnchorMode` plugin.
 *
 * This is what makes "the two creation experiences cannot be mixed" a property of the editor rather
 * than a rule the UI is trusted to follow: in anchor mode the only transactions that may change the
 * document are the anchor commands below and undoing them. Everything else — typing, pasting,
 * formatting, dropping an image — is rejected before it produces a step, so an anchor-mode session
 * cannot alter a single word of its parent.
 */
export function isAnchorEdit(transaction: Transaction): boolean {
  return (
    transaction.steps.length === 0 ||
    transaction.getMeta(ANCHOR_EDIT_META) === true ||
    transaction.getMeta(HISTORY_META) !== undefined
  )
}

/** Whether a transaction was dispatched by one of this module's commands, via `dispatchAnchorEdit`. */
export function isAnchorCommand(transaction: Transaction): boolean {
  return transaction.getMeta(ANCHOR_EDIT_META) === true
}

/**
 * What the polite live region in `DocumentEditor` announces after an anchor command runs. Carried
 * on the transaction's own meta rather than returned from the command, so it reaches `onUpdate` —
 * the one place both a button click and a keyboard shortcut (`extensions.ts`) end up — however the
 * command was invoked.
 */
export interface AnchorAnnouncement {
  message: string
}

const ANCHOR_ANNOUNCE_META = 'chronicleAnchorAnnounce'

/** Reads the announcement an anchor command attached to its transaction, if any. */
export function readAnchorAnnouncement(transaction: Transaction): AnchorAnnouncement | null {
  return (transaction.getMeta(ANCHOR_ANNOUNCE_META) as AnchorAnnouncement | undefined) ?? null
}

/**
 * UI state for one `anchorInsert` node view: which anchor's wording input is open, if any, and what
 * it held the moment it opened. Kept off the node's own attributes so it never becomes part of the
 * stored document. A `Ref` rather than a plain field because a node view mounted by
 * `VueNodeViewRenderer` needs Vue's own reactivity to notice a change here: ProseMirror's view only
 * re-renders a node whose document representation changed, and opening or closing a wording session
 * deliberately produces no such change.
 */
export interface AnchorInsertStorage {
  openAnchorId: Ref<string | null>
  /**
   * What the open node's wording held the instant its box opened — never touched by a keystroke
   * afterward. What `cancelAnchorInsert` restores on Escape, so reopening an anchor that already
   * had wording and backing out again does not destroy it (only a still-empty, freshly placed
   * anchor's box drops its node on Escape, matching today's behavior for that case).
   */
  openedText: Ref<string>
}

/** The value `AnchorInsert.addStorage` (`extensions.ts`) installs for every editor. */
export function createAnchorInsertStorage(): AnchorInsertStorage {
  return { openAnchorId: ref<string | null>(null), openedText: ref('') }
}

function anchorInsertStorage(editor: Editor): AnchorInsertStorage {
  return (editor.storage as unknown as Record<string, AnchorInsertStorage>)[ANCHOR_INSERT_NODE]
}

function openWordingBox(editor: Editor, anchorId: string, openedText: string): void {
  const storage = anchorInsertStorage(editor)
  storage.openAnchorId.value = anchorId
  storage.openedText.value = openedText
}

/**
 * Which anchors in the document an anchor-mode session may still edit — every id not sealed in from
 * an earlier, already-sealed child (`sealedAnchorIds`, `domain/anchors.ts`). Storage rather than a
 * plain field because the commands and node views that read it only ever have the `Editor` instance
 * to work from — `extensions.ts`'s `AnchorMode` extension seeds it once, at creation.
 */
export interface AnchorModeStorage {
  sealedAnchorIds: Set<string>
}

/** The value `AnchorMode.addStorage` (`extensions.ts`) installs for an anchor-mode editor. */
export function createAnchorModeStorage(): AnchorModeStorage {
  return { sealedAnchorIds: new Set() }
}

/** Undefined for any editor anchor mode was never turned on for — a text-mode revision, chiefly. */
function anchorModeStorage(editor: Editor): AnchorModeStorage | undefined {
  return (editor.storage as unknown as Record<string, AnchorModeStorage | undefined>).anchorMode
}

/**
 * Whether this session placed `anchorId` and may still change or remove it — false for a sealed
 * anchor from an earlier child, and false for every anchor when the editor isn't in anchor mode at
 * all (its own read-only rendering of anchors has nothing to make editable).
 */
export function isEditableAnchor(editor: Editor, anchorId: string): boolean {
  const sealed = anchorModeStorage(editor)?.sealedAnchorIds
  return sealed !== undefined && !sealed.has(anchorId)
}

/**
 * The sealed anchor ids `AnchorMode` computed at creation, or an empty set for an editor that was
 * never put into anchor mode. `DocumentEditor` reads this rather than the storage directly, so it
 * never has to know the key its own extension is stored under.
 */
export function sealedAnchorIdsOf(editor: Editor): ReadonlySet<string> {
  return anchorModeStorage(editor)?.sealedAnchorIds ?? new Set()
}

/** One editable anchor's outer extent and current kind — `anchorSpans` filtered to this session's own. */
export interface EditableAnchorRange extends AnchorRange {
  kind: AnchorKind | null
}

/**
 * The mark-and-node extents of every anchor this session may still edit, for the click resolution
 * in `DocumentEditor`'s `handleClick` (`innermostAnchorAt`, `domain/anchors.ts`). Empty whenever
 * `isEditableAnchor` would be false for everything — an ordinary text-mode editor has no anchor-mode
 * storage at all.
 */
export function editableAnchorRanges(editor: Editor): EditableAnchorRange[] {
  const sealed = anchorModeStorage(editor)?.sealedAnchorIds
  if (!sealed) return []

  const kinds = new Map(
    collectAnchors(editor.state.doc.toJSON() as EntryDocument).map((anchor) => [
      anchor.anchor_id,
      anchor.kind,
    ]),
  )

  return anchorSpans(editor.state.doc)
    .filter((span) => !sealed.has(span.anchor_id))
    .map((span) => ({
      anchor_id: span.anchor_id,
      from: span.from,
      to: span.to,
      kind: kinds.get(span.anchor_id) ?? null,
    }))
}

/** One anchor's mark-only extent and kind — never a bare insertion, which has no mark to measure. */
interface AnchorMarkExtent extends AnchorRange {
  kind: AnchorKind
}

/**
 * The mark-only extent of every anchor in the document that has a mark at all, this session's own or
 * an earlier child's sealed one alike — what `markAnchor` checks a fresh selection against to keep
 * anchors exclusive (PRODUCT.md §4.4): touching any existing anchor's marked passage at all blocks
 * placing a new one over it, whoever placed the one already there.
 *
 * Deliberately the mark alone, not the outer mark-and-node extent `editableAnchorRanges` reports for
 * click resolution: a selection naturally covers only the marked words, never the invisible
 * `anchorInsert` atom sitting right after them. Measuring against that atom's own extent would make
 * an anchor impossible to reselect exactly the moment it gained any committed wording, since the
 * outer span grows past the text a person actually selects.
 */
function allMarkExtents(editor: Editor): AnchorMarkExtent[] {
  const doc = editor.state.doc

  return collectAnchors(doc.toJSON() as EntryDocument).flatMap((anchor) => {
    if (!anchor.kind) return []
    const pieces = anchorMarkRanges(doc, anchor.anchor_id)
    if (pieces.length === 0) return []

    return [
      {
        anchor_id: anchor.anchor_id,
        kind: anchor.kind,
        from: Math.min(...pieces.map((piece) => piece.from)),
        to: Math.max(...pieces.map((piece) => piece.to)),
      },
    ]
  })
}

/**
 * Marks a range as an anchor and returns its new id, or null when there is nothing to mark.
 *
 * `range` defaults to the current selection, which is what lets one command serve both entry
 * points: `AnchorMenu`'s buttons read the live selection, while the `Mod-Alt-h` / `Mod-Alt-s`
 * keyboard shortcuts (`extensions.ts`) call this with no range at all. Called through `markAnchor`
 * below, which is what routes a selection matching an anchor already placed to editing it instead —
 * this function itself always creates a new one.
 *
 * A wording box opens immediately after the mark, empty and focused, in the **same** transaction —
 * one undo removes both, and there is no hidden "type to discover it" step between marking a
 * passage and seeing somewhere to write about it. `inclusive: false` on the mark (`extensions.ts`)
 * is what keeps that box's position outside the anchor's own range, so accepting it empty and later
 * widening the highlight can never absorb it.
 */
export function addAnchorMark(
  editor: Editor,
  kind: AnchorKind,
  range?: { from: number; to: number },
): string | null {
  const { state } = editor
  const raw = range ?? state.selection
  const markType = state.schema.marks[ANCHOR_MARK]
  const insertType = state.schema.nodes[ANCHOR_INSERT_NODE]
  if (raw.from === raw.to || !markType || !insertType) return null

  // A drag-selection routinely swallows a word's neighboring space without meaning to. Trimming it
  // off here keeps a highlight's background from bleeding onto whitespace, and makes the wording
  // that follows land at the same predictable spot — right after the last real character — no matter
  // exactly where the selection's edges fell. A selection that was nothing but whitespace has
  // nothing left to anchor. There's no user-facing way to widen or shrink an anchor's span once
  // placed (PRODUCT.md §4.4) anyway, so trimming here costs no capability worth keeping.
  const untrimmed = state.doc.textBetween(raw.from, raw.to)
  const from = raw.from + (untrimmed.length - untrimmed.trimStart().length)
  const to = raw.to - (untrimmed.length - untrimmed.trimEnd().length)
  if (from >= to) return null

  const anchorId = newAnchorId()
  const quote = state.doc.textBetween(from, to, ' ')
  const insertNode = insertType.create({ anchorId, text: '' })

  const transaction = state.tr.addMark(from, to, markType.create({ anchorId, kind }))
  transaction.insert(to, insertNode)
  transaction.setSelection(TextSelection.create(transaction.doc, to + insertNode.nodeSize))
  transaction.setMeta(ANCHOR_ANNOUNCE_META, {
    message: `${kind === 'strike' ? 'Struck' : 'Highlighted'} "${quote}"`,
  } satisfies AnchorAnnouncement)

  openWordingBox(editor, anchorId, '')
  dispatchAnchorEdit(editor, transaction)
  return anchorId
}

/**
 * The single entry point for turning a selection into an anchor, or reopening one already there.
 * `AnchorMenu`'s buttons and the `Mod-Alt-h` / `Mod-Alt-s` shortcuts (`extensions.ts`) call this
 * rather than `addAnchorMark` directly, and it is what keeps anchors exclusive: no two anchors may
 * ever cover overlapping text, whoever placed them (PRODUCT.md §4.4).
 *
 * A selection touching an existing anchor's marked passage at all — the whole thing, part of it, or
 * a range that swallows it — never creates a new anchor there. If it's this session's own, its
 * wording box opens instead, so overlapping it is how you get back to an anchor you've already
 * placed. If it's sealed, nothing happens: only the child that placed it may still change it, and
 * there is no "layer a second opinion over it" gesture — write a new child entry instead. A
 * selection touching no anchor at all marks a fresh one, same as always.
 */
export function markAnchor(
  editor: Editor,
  kind: AnchorKind,
  range?: { from: number; to: number },
): string | null {
  const { from, to } = range ?? editor.state.selection
  if (from === to) return null

  const overlapping = anchorRangeOverlapping(allMarkExtents(editor), from, to)
  if (overlapping) {
    if (!isEditableAnchor(editor, overlapping.anchor_id)) return null
    openAnchorWording(editor, overlapping.anchor_id)
    return overlapping.anchor_id
  }

  return addAnchorMark(editor, kind, { from, to })
}

/**
 * Switches an editable anchor's mark kind in place — Highlight ↔ Strike — touching neither its span
 * nor its wording. A no-op, with no transaction and no tick, when `kind` already matches, so
 * clicking the already-active kind in a reopened wording box changes nothing.
 *
 * Acts on every per-text-node piece of the mark (`anchorMarkRanges`), not the outer extent
 * `anchorSpans` reports, because a *newer* anchor's `anchorInsert` node can sit inside an *older*
 * anchor's range — layering `removeMark`/`addMark` over the whole extent would touch that atom too.
 */
export function setAnchorKind(editor: Editor, anchorId: string, kind: AnchorKind): boolean {
  const { state } = editor
  const markType = state.schema.marks[ANCHOR_MARK]
  if (!markType) return false

  const pieces = anchorMarkRanges(state.doc, anchorId)
  if (pieces.length === 0) return false

  const currentKind = collectAnchors(state.doc.toJSON() as EntryDocument).find(
    (anchor) => anchor.anchor_id === anchorId,
  )?.kind
  if (currentKind === kind) return false

  let transaction = state.tr
  for (const { from, to, mark } of pieces) {
    transaction = transaction
      .removeMark(from, to, mark)
      .addMark(from, to, markType.create({ anchorId, kind }))
  }

  transaction.setMeta(ANCHOR_ANNOUNCE_META, {
    message: `Changed to ${kind === 'strike' ? 'strike' : 'highlight'}`,
  } satisfies AnchorAnnouncement)

  dispatchAnchorEdit(editor, transaction)
  return true
}

/**
 * Removes an anchor outright: every piece of its mark, and its `anchorInsert` node if it has one.
 * The one gesture that takes back a passage entirely, rather than converting or reopening it — see
 * ENTRY_MODEL.md's non-destructive invariant, which this still holds: the marked *text* is never
 * touched, only the mark on it.
 */
export function removeAnchor(editor: Editor, anchorId: string): void {
  const { state } = editor

  const found = collectAnchors(state.doc.toJSON() as EntryDocument).find(
    (anchor) => anchor.anchor_id === anchorId,
  )
  // A mark anchor announces its quote; a bare insertion has none, so its wording stands in instead —
  // and an insertion still empty when removed (opened, then immediately discarded this way rather
  // than via Escape) has neither, so this falls back to a description with nothing to quote at all.
  const description = found?.quote || found?.insertion

  anchorInsertStorage(editor).openAnchorId.value = null

  let transaction = state.tr
  for (const { from, to, mark } of anchorMarkRanges(state.doc, anchorId)) {
    transaction = transaction.removeMark(from, to, mark)
  }

  // Found against the original, unmutated document: `removeMark` above never changes document
  // size, so the position found there still points at the same node on `transaction.doc`.
  const existing = findAnchorInsert(state.doc, anchorId)
  if (existing) {
    transaction = transaction.delete(existing.pos, existing.pos + existing.node.nodeSize)
  }

  transaction.setMeta(ANCHOR_ANNOUNCE_META, {
    message: description ? `Removed "${description}"` : 'Removed anchor',
  } satisfies AnchorAnnouncement)

  dispatchAnchorEdit(editor, transaction)
}

/**
 * Opens an anchor's wording box for editing — the one mechanism behind both entry points into a
 * wording session: clicking a placed anchor to reopen it (`appendText` omitted, existing wording
 * kept as-is) and typing at the caret right after a mark this session placed (`appendText` is the
 * character just typed, from `DocumentEditor`'s `handleTextInput`).
 *
 * Routing both through one function is what stops a highlight that already has committed wording
 * from growing a *second* `anchorInsert` node sharing its id: the caret's neighboring mark alone
 * cannot tell "this anchor already has a node" from "it doesn't yet", so only a lookup can. Appends
 * to the existing node when there is one; otherwise inserts a fresh node right after the mark's own
 * extent, matching where `addAnchorMark` places its own.
 */
export function openAnchorWording(
  editor: Editor,
  anchorId: string,
  appendText = '',
): string | null {
  const { state } = editor
  const insertType = state.schema.nodes[ANCHOR_INSERT_NODE]
  if (!insertType) return null

  const existing = findAnchorInsert(state.doc, anchorId)

  if (existing) {
    const openedText = String(existing.node.attrs.text ?? '')
    const transaction = appendText
      ? state.tr.setNodeAttribute(existing.pos, 'text', openedText + appendText)
      : state.tr

    openWordingBox(editor, anchorId, openedText)
    dispatchAnchorEdit(editor, transaction)
    return anchorId
  }

  const span = anchorSpans(state.doc).find((candidate) => candidate.anchor_id === anchorId)
  if (!span) return null

  const insertNode = insertType.create({ anchorId, text: appendText })
  const transaction = state.tr.insert(span.to, insertNode)
  transaction.setSelection(TextSelection.create(transaction.doc, span.to + insertNode.nodeSize))

  openWordingBox(editor, anchorId, '')
  dispatchAnchorEdit(editor, transaction)
  return anchorId
}

/**
 * Opens a fresh wording session at `pos` for a bare insertion — an empty caret with nothing
 * pairable before it (`pairableAnchorAt`, `domain/anchors.ts`). Places an `anchorInsert` node
 * carrying `text` as its first character and marks it the open one, so its node view
 * (`AnchorInsertView.vue`) mounts an input and focuses it. Called from `DocumentEditor`'s
 * `handleTextInput` hook; when something pairable *does* sit before the caret, `openAnchorWording`
 * handles it instead.
 */
export function openAnchorInsert(editor: Editor, pos: number, text: string): string | null {
  const nodeType = editor.state.schema.nodes[ANCHOR_INSERT_NODE]
  if (!nodeType) return null

  const anchorId = newAnchorId()
  const transaction = editor.state.tr.insert(pos, nodeType.create({ anchorId, text }))

  openWordingBox(editor, anchorId, '')
  dispatchAnchorEdit(editor, transaction)
  return anchorId
}

/**
 * Carries the current full text of an open wording box on a `updateAnchorInsertText` transaction,
 * for the tick policy's punctuation check — see that function's own note on why. Named for its
 * payload, not "tick": this keystroke is never itself the structural `'anchor'` reason, only ever a
 * candidate for the ordinary `pause` / `punctuation` / `interval` ones.
 */
const ANCHOR_WORDING_TEXT_META = 'chronicleAnchorWordingText'

/** Reads the wording text a keystroke transaction carries, if any — see `ANCHOR_WORDING_TEXT_META`. */
export function readAnchorWordingText(transaction: Transaction): string | null {
  return (transaction.getMeta(ANCHOR_WORDING_TEXT_META) as string | undefined) ?? null
}

/**
 * Updates the text an open `anchorInsert` node carries, called on every keystroke in its input.
 * Still meta-stamped so the anchor-mode guard lets it through, but otherwise an ordinary attribute
 * change — the node stays an atom the surrounding document can never be typed into directly.
 *
 * Not itself the structural `'anchor'` tick: per CLAUDE.md and ENTRY_MODEL.md, "Authoring capture",
 * one tick policy judges every stream the same way, and typing wording is typing — it earns a
 * bookmark the same way prose does, from a pause, a finished sentence, or the interval, never from
 * "this keystroke happened to be the last one before Enter". `ANCHOR_WORDING_TEXT_META` is what lets
 * `DocumentEditor` read a punctuation check off it despite this not being an ordinary text-insertion
 * step with a slice `insertedTextOf` can read.
 */
export function updateAnchorInsertText(editor: Editor, pos: number, text: string): void {
  const transaction = editor.state.tr.setNodeAttribute(pos, 'text', text)
  transaction.setMeta(ANCHOR_WORDING_TEXT_META, text)
  dispatchAnchorEdit(editor, transaction)
}

/**
 * Commits an open wording session: keeps the node with its trimmed text, or drops it outright if
 * nothing was typed — an insert with no wording says nothing, whether it was never written or
 * edited back down to nothing.
 *
 * Skips the transaction entirely when the trimmed text is non-empty and unchanged from what the box
 * opened with — reopening an anchor and closing it again without editing anything is not a change at
 * all. When it *is* changed, this dispatch is ordinarily a content no-op in its own right: every
 * keystroke already wrote the same final value via `updateAnchorInsertText`, so TipTap's own
 * `prevState.doc.eq(state.doc)` check silently drops the `update` event for it — there is nothing
 * here left for a tick to attach to, which is the other half of why settling wording isn't the
 * `'anchor'` moment. Dropping the node *is* a real structural change (and always reaches `update`,
 * since the doc shrinks): the anchor's id drops out of the document's anchor set entirely, which is
 * what `DocumentEditor`'s outcome-based comparison (`contentDelta`) reads as an anchor change, the
 * same as removing one via the dedicated button (`removeAnchor`) — for a bare insertion with no
 * mark, emptying its wording and committing *is* how it's removed.
 */
export function commitAnchorInsert(editor: Editor, pos: number, text: string): void {
  const storage = anchorInsertStorage(editor)
  const openedText = storage.openedText.value
  storage.openAnchorId.value = null

  const trimmed = text.trim()
  if (trimmed && trimmed === openedText) return

  const transaction = trimmed
    ? editor.state.tr.setNodeAttribute(pos, 'text', trimmed)
    : editor.state.tr.delete(pos, pos + 1)

  if (trimmed) {
    transaction.setMeta(ANCHOR_ANNOUNCE_META, {
      message: `Added wording "${trimmed}"`,
    } satisfies AnchorAnnouncement)
  } else if (openedText) {
    transaction.setMeta(ANCHOR_ANNOUNCE_META, {
      message: 'Cleared wording',
    } satisfies AnchorAnnouncement)
  }

  dispatchAnchorEdit(editor, transaction)
}

/**
 * Discards an open wording session — Escape. Restores whatever the box held the moment it opened
 * (`AnchorInsertStorage.openedText`): for a freshly placed anchor that's always empty, so the node
 * is dropped outright, same as before this box could ever hold anything else; for a reopened anchor
 * that already had wording, its previous text comes back untouched rather than being destroyed.
 */
export function cancelAnchorInsert(editor: Editor, pos: number): void {
  const storage = anchorInsertStorage(editor)
  const openedText = storage.openedText.value
  storage.openAnchorId.value = null

  const transaction = openedText
    ? editor.state.tr.setNodeAttribute(pos, 'text', openedText)
    : editor.state.tr.delete(pos, pos + 1)

  dispatchAnchorEdit(editor, transaction)
}

/** Where one anchor sits in a document, in ProseMirror positions. */
export interface AnchorSpan {
  anchor_id: string
  quote: string
  from: number
  to: number
}

/**
 * The region each anchor occupies, taken as the outermost extent of its pieces.
 *
 * A strike and the wording replacing it are one anchor in two places, adjacent by construction, so
 * one span covering both is the region the anchor is responsible for — and it means deleting the
 * proposed wording counts as disturbing the anchor just as deleting the struck text does.
 */
export function anchorSpans(doc: ProseMirrorNode): AnchorSpan[] {
  const spans = new Map<string, AnchorSpan>()

  const extend = (anchorId: string, from: number, to: number, quote: string) => {
    const existing = spans.get(anchorId)
    if (!existing) {
      spans.set(anchorId, { anchor_id: anchorId, quote, from, to })
      return
    }

    existing.from = Math.min(existing.from, from)
    existing.to = Math.max(existing.to, to)
    existing.quote += quote
  }

  doc.descendants((node, pos) => {
    if (node.type.name === ANCHOR_INSERT_NODE) {
      const anchorId = node.attrs.anchorId
      if (typeof anchorId === 'string' && anchorId) extend(anchorId, pos, pos + node.nodeSize, '')
      return false
    }

    if (!node.isText) return true

    for (const mark of node.marks) {
      if (mark.type.name !== ANCHOR_MARK) continue
      const anchorId = mark.attrs.anchorId
      if (typeof anchorId === 'string' && anchorId) {
        extend(anchorId, pos, pos + node.nodeSize, node.text ?? '')
      }
    }

    return true
  })

  return [...spans.values()]
}

/**
 * The individual text-node pieces of one anchor's *mark*, before merging into an outer extent — a
 * mutation (`setAnchorKind`, `removeAnchor`) must act on exactly these, not the outer extent
 * `anchorSpans` reports: a *newer* anchor's `anchorInsert` node can sit inside an *older* anchor's
 * range, and `addMark`/`removeMark` over the whole extent would touch that atom node too.
 *
 * Carries each piece's actual `Mark` instance, not just its type, because the mark's own `excludes:
 * ''` (`extensions.ts`) lets a different anchor's mark legally share a span with this one —
 * `removeMark`/`setAnchorKind` must remove precisely this mark, not every anchor mark ProseMirror
 * finds in the range. Passing the bare mark *type* there instead would strip a different, unrelated
 * anchor's mark out from under it.
 */
export function anchorMarkRanges(
  doc: ProseMirrorNode,
  anchorId: string,
): { from: number; to: number; mark: Mark }[] {
  const pieces: { from: number; to: number; mark: Mark }[] = []

  doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const mark of node.marks) {
      if (mark.type.name === ANCHOR_MARK && mark.attrs.anchorId === anchorId) {
        pieces.push({ from: pos, to: pos + node.nodeSize, mark })
      }
    }
    return true
  })

  return pieces
}

/** The position and node of the `anchorInsert` node carrying `anchorId`, if the document has one. */
function findAnchorInsert(
  doc: ProseMirrorNode,
  anchorId: string,
): { pos: number; node: ProseMirrorNode } | null {
  const insertType = doc.type.schema.nodes[ANCHOR_INSERT_NODE]
  let found: { pos: number; node: ProseMirrorNode } | null = null

  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type === insertType && node.attrs.anchorId === anchorId) {
      found = { pos, node }
      return false
    }
    return true
  })

  return found
}

/** One span moved through an edit: the judgment `anchorsAffectedBy` reads, plus where it landed. */
export type MappedAnchorSpan = AnchorMapping & Pick<AnchorSpan, 'from' | 'to'>

/**
 * Moves each span through an edit and reports what that edit did to it, for `anchorsAffectedBy` to
 * judge. Positions come back alongside the judgment, not just the judgment alone, because a
 * revision session runs many edits in sequence and each one has to resume tracking from where the
 * last left off — a caller keeps calling this with the spans it returned, chaining one transaction
 * at a time, rather than trying to compose every step's `Mapping` itself.
 *
 * The endpoints are mapped with opposite biases, matching the mark's `inclusive: false`: text typed
 * at the start stays outside it, text typed at the end likewise, so a pure shift leaves the length
 * alone and only a change *inside* the span moves it.
 */
export function mapAnchorSpans(spans: AnchorSpan[], mapping: Mapping): MappedAnchorSpan[] {
  return spans.map((span) => {
    const start = mapping.mapResult(span.from, 1)
    const end = mapping.mapResult(span.to, -1)
    const from = start.pos
    const to = Math.max(from, end.pos)

    return {
      anchor_id: span.anchor_id,
      quote: span.quote,
      length: span.to - span.from,
      mappedLength: to - from,
      deletedInside: start.deletedAfter || end.deletedBefore,
      from,
      to,
    }
  })
}

function dispatchAnchorEdit(editor: Editor, transaction: Transaction): void {
  transaction.setMeta(ANCHOR_EDIT_META, true)
  editor.view.dispatch(transaction)
}
