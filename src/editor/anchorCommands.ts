import type { Editor } from '@tiptap/core'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { Mark, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import { type EditorState, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import {
  type AnchorRange,
  anchorRangeOverlapping,
  collectAnchors,
  type DocumentAnchor,
  newAnchorId,
} from '@/domain/anchors'
import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  ANCHOR_WORDING_MARK,
  type EntryDocument,
} from '@/domain/entryDocument'
import type { AnchorKind } from '@/types/entry'

import type { SealedAnchors } from './anchorGuard'

// The imperative half of anchor mode: commands that place, edit, or read anchors on an editor that
// already exists, and the typing rules anchor mode's plugin runs. `extensions.ts` is the schema
// these operate on and installs the plugins, kept separate so each file answers one question: what
// an anchor *is* (extensions.ts) versus what a session *does* with one (here).

/**
 * Marks a transaction as one of this module's anchor commands, which the guard (`anchorGuard.ts`)
 * lets through whole.
 */
export const ANCHOR_EDIT_META = 'chronicleAnchorEdit'

/**
 * The guard's snapshot (`sealAnchors`), held as its plugin's state in every editor. Every anchor in
 * it is sealed; any other is one this session placed.
 */
export const SEALED_ANCHORS = new PluginKey<SealedAnchors>('sealedAnchors')

function sealedOf(state: EditorState): SealedAnchors {
  return SEALED_ANCHORS.getState(state)!
}

const ANCHOR_ANNOUNCE_META = 'chronicleAnchorAnnounce'

/**
 * Attaches what the polite live region in `DocumentEditor` announces after an anchor command runs.
 * Carried on the transaction's own meta rather than returned from the command, so it reaches
 * `onUpdate` — the one place both a button click and a keyboard shortcut (`extensions.ts`) end up —
 * however the command was invoked.
 */
function announce(transaction: Transaction, message: string): void {
  transaction.setMeta(ANCHOR_ANNOUNCE_META, message)
}

/** Reads the announcement an anchor command attached to its transaction, if any. */
export function readAnchorAnnouncement(transaction: Transaction): string | null {
  return (transaction.getMeta(ANCHOR_ANNOUNCE_META) as string | undefined) ?? null
}

/** The anchor with this id in the editor's current document, if it's there. */
function findAnchor(state: EditorState, anchorId: string): DocumentAnchor | undefined {
  return collectAnchors(state.doc.toJSON() as EntryDocument).find(
    (anchor) => anchor.anchor_id === anchorId,
  )
}

/**
 * The region each anchor occupies, taken as the outermost extent of its pieces. A passage and its
 * wording are one anchor in two places, adjacent by construction, so the guard judges them as one
 * stretch.
 */
export function anchorSpans(doc: ProseMirrorNode): AnchorRange[] {
  const spans = new Map<string, AnchorRange>()

  const extend = (anchorId: string, from: number, to: number) => {
    const existing = spans.get(anchorId)
    if (!existing) {
      spans.set(anchorId, { anchor_id: anchorId, from, to })
      return
    }

    existing.from = Math.min(existing.from, from)
    existing.to = Math.max(existing.to, to)
  }

  doc.descendants((node, pos) => {
    if (node.type.name === ANCHOR_INSERT_NODE) {
      const anchorId = node.attrs.anchorId
      if (typeof anchorId === 'string' && anchorId) extend(anchorId, pos, pos + node.nodeSize)
      return false
    }

    if (!node.isText) return true

    for (const mark of node.marks) {
      if (mark.type.name !== ANCHOR_MARK && mark.type.name !== ANCHOR_WORDING_MARK) continue
      const anchorId = mark.attrs.anchorId
      if (typeof anchorId === 'string' && anchorId) extend(anchorId, pos, pos + node.nodeSize)
    }

    return true
  })

  return [...spans.values()]
}

/** One of the session's own anchors: its outer extent and current kind. */
export interface OwnAnchor extends AnchorRange {
  kind: AnchorKind | null
}

/**
 * The session's own anchor at `pos`, its passage and its wording both counting, edges included.
 * Where two touch, the one ending at `pos`, which text typed there joins (`markTyped`). Null
 * outside anchor mode, where the editor seals every anchor it opens with.
 */
export function ownAnchorAt(state: EditorState, pos: number): OwnAnchor | null {
  const sealed = sealedOf(state)
  const hit = anchorSpans(state.doc).find(
    (span) => !sealed.has(span.anchor_id) && span.from <= pos && pos <= span.to,
  )
  return hit ? { ...hit, kind: findAnchor(state, hit.anchor_id)?.kind ?? null } : null
}

/** One text node carrying an anchor mark, with that mark. */
interface MarkPiece {
  anchorId: string
  from: number
  to: number
  mark: Mark
}

/**
 * Every text node carrying a `markName` mark, with that mark's own instance: a mutation must remove
 * precisely that mark, not every one of its type in the range.
 */
function anchorPieces(doc: ProseMirrorNode, markName: string): MarkPiece[] {
  const pieces: MarkPiece[] = []

  doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const mark of node.marks) {
      if (mark.type.name === markName) {
        pieces.push({
          anchorId: String(mark.attrs.anchorId),
          from: pos,
          to: pos + node.nodeSize,
          mark,
        })
      }
    }
    return true
  })

  return pieces
}

function piecesOf(doc: ProseMirrorNode, markName: string, anchorId: string): MarkPiece[] {
  return anchorPieces(doc, markName).filter((piece) => piece.anchorId === anchorId)
}

function dispatchAnchorEdit(editor: Editor, transaction: Transaction): void {
  transaction.setMeta(ANCHOR_EDIT_META, true)
  editor.view.dispatch(transaction)
}

/**
 * Moves the caret to the end of an anchor's wording, or of its passage while it has none, where
 * typing adds to it. Focuses the document too, so a menu button pressed from the keyboard hands the
 * typing back.
 */
function focusAnchor(editor: Editor, anchorId: string): boolean {
  const span = anchorSpans(editor.state.doc).find((candidate) => candidate.anchor_id === anchorId)
  if (!span) return false

  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, span.to)),
  )
  editor.view.focus()
  return true
}

/**
 * Marks a range as an anchor and returns its new id, or null when there is nothing to mark. The
 * caret lands at the passage's end, where typing becomes its wording (`markTyped`).
 */
function addAnchorMark(
  editor: Editor,
  kind: AnchorKind,
  raw: { from: number; to: number },
): string | null {
  const { state } = editor
  const markType = state.schema.marks[ANCHOR_MARK]!

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

  const transaction = state.tr.addMark(from, to, markType.create({ anchorId, kind }))
  transaction.setSelection(TextSelection.create(transaction.doc, to))
  announce(transaction, `${kind === 'strike' ? 'Struck' : 'Highlighted'} "${quote}"`)

  dispatchAnchorEdit(editor, transaction)
  editor.view.focus()
  return anchorId
}

/**
 * Turns a selection into an anchor, and keeps anchors exclusive: no two may cover overlapping
 * text, whoever placed them (PRODUCT.md §4.4).
 *
 * A selection touching an anchor already there — its passage or its wording, in whole or in part —
 * never creates a new one. If it's this session's own, the caret moves to it instead. If it's
 * sealed, nothing happens: only the entry that placed it may change it.
 */
function markAnchor(editor: Editor, kind: AnchorKind): string | null {
  const { from, to } = editor.state.selection
  if (from === to) return null

  const overlapping = anchorRangeOverlapping(anchorSpans(editor.state.doc), from, to)
  if (overlapping) {
    if (sealedOf(editor.state).has(overlapping.anchor_id)) return null
    focusAnchor(editor, overlapping.anchor_id)
    return overlapping.anchor_id
  }

  return addAnchorMark(editor, kind, { from, to })
}

/**
 * Switches an anchor's mark kind in place — Highlight ↔ Strike — touching neither its span nor its
 * wording. A no-op, with no transaction and no event, when `kind` already matches.
 */
function setAnchorKind(editor: Editor, anchorId: string, kind: AnchorKind): boolean {
  const { state } = editor
  const markType = state.schema.marks[ANCHOR_MARK]!

  const pieces = piecesOf(state.doc, ANCHOR_MARK, anchorId)
  if (pieces.length === 0) return false

  if (findAnchor(state, anchorId)?.kind === kind) return false

  let transaction = state.tr
  for (const { from, to, mark } of pieces) {
    transaction = transaction
      .removeMark(from, to, mark)
      .addMark(from, to, markType.create({ anchorId, kind }))
  }

  announce(transaction, `Changed to ${kind === 'strike' ? 'strike' : 'highlight'}`)

  dispatchAnchorEdit(editor, transaction)
  return true
}

/**
 * Highlight or Strike, from `AnchorMenu` or its shortcuts: marks a selection (`markAnchor`), or
 * switches the kind of the session's own anchor at the caret. False when there's nothing to act on,
 * so a shortcut falls through.
 */
export function applyAnchorKind(editor: Editor, kind: AnchorKind): boolean {
  const { selection } = editor.state
  if (!selection.empty) return markAnchor(editor, kind) !== null

  const anchor = ownAnchorAt(editor.state, selection.from)
  if (!anchor?.kind) return false

  setAnchorKind(editor, anchor.anchor_id, kind)
  return true
}

/**
 * Removes an anchor outright: the mark from its passage, which stays the parent's text
 * (ENTRY_MODEL.md's non-destructive invariant), and its wording, which is deleted.
 */
export function removeAnchor(editor: Editor, anchorId: string): void {
  const { state } = editor

  const found = findAnchor(state, anchorId)
  // A bare insertion has no quote, so its wording stands in.
  const description = found?.quote || found?.insertion

  const transaction = state.tr
  for (const { from, to, mark } of piecesOf(state.doc, ANCHOR_MARK, anchorId)) {
    transaction.removeMark(from, to, mark)
  }
  // Last to first, so each deletion leaves the earlier pieces where they were.
  for (const { from, to } of piecesOf(state.doc, ANCHOR_WORDING_MARK, anchorId).reverse()) {
    transaction.delete(from, to)
  }

  announce(transaction, description ? `Removed "${description}"` : 'Removed anchor')

  dispatchAnchorEdit(editor, transaction)
  editor.view.focus()
}

/**
 * Text typed at `[from, to)` inside the session's own passage, sent to the end of its wording
 * instead, since the passage is the parent's text. Null anywhere else. An IME composition there
 * doesn't come through here, so it still splits the passage.
 */
function typedOnPassage(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): Transaction | null {
  if (from !== to) return null

  const sealed = sealedOf(state)
  const passage = state.doc
    .resolve(from)
    .marks()
    .find((mark) => mark.type.name === ANCHOR_MARK && !sealed.has(String(mark.attrs.anchorId)))
  const span = passage && anchorSpans(state.doc).find((s) => s.anchor_id === passage.attrs.anchorId)
  if (!span) return null

  const wording = state.schema.marks[ANCHOR_WORDING_MARK]!.create({ anchorId: span.anchor_id })
  const transaction = state.tr.insert(span.to, state.schema.text(text, [wording]))
  transaction.setSelection(TextSelection.create(transaction.doc, span.to + text.length))
  return transaction.setMeta(ANCHOR_EDIT_META, true)
}

/** Anchor mode's `handleTextInput` (`typedOnPassage`). True when it took the text. */
export function routeTypingOnPassage(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const transaction = typedOnPassage(view.state, from, to, text)
  if (transaction) view.dispatch(transaction)
  return transaction !== null
}

/**
 * Anchor mode's `handleClick`: a click on the session's own passage puts the caret at the end of
 * its wording, as typing there would. A click on wording, edges included, keeps the caret where it
 * landed. True when it moved the caret.
 */
export function routeClickOnPassage(editor: Editor, pos: number): boolean {
  const anchor = ownAnchorAt(editor.state, pos)
  if (!anchor) return false

  const wording = piecesOf(editor.state.doc, ANCHOR_WORDING_MARK, anchor.anchor_id)
  if (wording.some((piece) => piece.from <= pos && pos <= piece.to)) return false

  return focusAnchor(editor, anchor.anchor_id)
}

/** Anchor mode's `handlePaste`: the clipboard's text, typed as one line (`typedOnPassage`). */
export function pasteAsLine(view: EditorView, slice: Slice): boolean {
  const line = slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\s*\n\s*/g, ' ')
  if (!line) return true

  const { state } = view
  const { from, to } = state.selection
  const transaction = typedOnPassage(state, from, to, line) ?? state.tr.insertText(line)
  view.dispatch(transaction.setMeta('uiEvent', 'paste'))
  return true
}

/** False for anchor commands, which mark their own text, and undo, which restores its marks. */
function needsMarking(transaction: Transaction): boolean {
  return transaction.getMeta(ANCHOR_EDIT_META) !== true && !isHistoryTransaction(transaction)
}

/**
 * Where the text typed in `transactions` sits in the final document. A step's map gives its
 * insertion in the document just after that step, so the range is carried through every later
 * step, in any transaction, which may shift or delete it.
 */
function typedRanges(transactions: readonly Transaction[]): { from: number; to: number }[] {
  const steps = transactions.flatMap((transaction) =>
    transaction.mapping.maps.map((map) => ({ map, typed: needsMarking(transaction) })),
  )
  const all = new Mapping(steps.map(({ map }) => map))
  const ranges: { from: number; to: number }[] = []

  steps.forEach(({ map, typed }, i) => {
    if (!typed) return
    const later = all.slice(i + 1)
    map.forEach((_oldFrom, _oldTo, from, to) => {
      if (to > from) ranges.push({ from: later.map(from, 1), to: later.map(to, -1) })
    })
  })

  return ranges.filter((range) => range.to > range.from) // A later deletion collapses one.
}

/** The id of the session's own anchor that `node` carries one of `markNames` for. */
function ownAnchorOn(
  node: ProseMirrorNode | null | undefined,
  markNames: string[],
  sealed: SealedAnchors,
): string | null {
  const mark = node?.marks.find(
    (candidate) =>
      markNames.includes(candidate.type.name) && !sealed.has(String(candidate.attrs.anchorId)),
  )
  return mark ? String(mark.attrs.anchorId) : null
}

/**
 * The session's own anchor that text inserted at `[from, to)` joins: the wording or passage it
 * follows, or the wording it precedes. Null for a bare insertion. A sealed anchor never absorbs it,
 * which would attach this entry's wording to an earlier entry's anchor.
 */
function ownAnchorBeside(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  sealed: SealedAnchors,
): string | null {
  return (
    ownAnchorOn(doc.resolve(from).nodeBefore, [ANCHOR_MARK, ANCHOR_WORDING_MARK], sealed) ??
    ownAnchorOn(doc.resolve(to).nodeAfter, [ANCHOR_WORDING_MARK], sealed)
  )
}

/**
 * Anchor mode's `appendTransaction`, which the guard relies on: text typed anywhere becomes
 * wording, carrying exactly one wording mark, its own anchor's or a fresh id's.
 *
 * Runs during an IME composition too, never deferred to its end: the guard would refuse each
 * composition update whose earlier characters weren't wording yet, leaving stray characters.
 */
export function markTyped(
  transactions: readonly Transaction[],
  state: EditorState,
): Transaction | null {
  const ranges = typedRanges(transactions)
  if (ranges.length === 0) return null

  const sealed = sealedOf(state)
  const wordingType = state.schema.marks[ANCHOR_WORDING_MARK]!
  const transaction = state.tr
  for (const { from, to } of ranges) {
    const anchorId = ownAnchorBeside(state.doc, from, to, sealed) ?? newAnchorId()
    // The mark excludes every other, so this strips whatever the text inherited.
    transaction.addMark(from, to, wordingType.create({ anchorId }))
  }

  return transaction.docChanged ? transaction.setMeta(ANCHOR_EDIT_META, true) : null
}

function wordingPlaceholder(): HTMLElement {
  const placeholder = document.createElement('span')
  placeholder.className = 'chronicle-anchor-placeholder'
  placeholder.textContent = 'Add wording…'
  placeholder.contentEditable = 'false'
  placeholder.setAttribute('aria-hidden', 'true')
  return placeholder
}

/**
 * Anchor mode's decorations on the session's own anchors: all their wording as editable, the
 * wording at the caret outlined as open, and a placeholder at the caret after a passage with none.
 */
export function anchorModeDecorations(state: EditorState): DecorationSet {
  const sealed = sealedOf(state)
  const { doc, selection } = state
  const caret = selection.empty ? selection.from : null
  const decorations: Decoration[] = []
  const worded = new Set<string>()

  for (const piece of anchorPieces(doc, ANCHOR_WORDING_MARK)) {
    worded.add(piece.anchorId)
    if (sealed.has(piece.anchorId)) continue
    const open = caret !== null && piece.from <= caret && caret <= piece.to
    decorations.push(
      Decoration.inline(piece.from, piece.to, {
        class: open
          ? 'chronicle-anchor-wording--editable chronicle-anchor-wording--open'
          : 'chronicle-anchor-wording--editable',
      }),
    )
  }

  for (const span of anchorSpans(doc)) {
    if (span.to !== caret || sealed.has(span.anchor_id) || worded.has(span.anchor_id)) continue
    decorations.push(
      Decoration.widget(caret, wordingPlaceholder, { side: 1, key: 'anchor-placeholder' }),
    )
  }

  return DecorationSet.create(doc, decorations)
}
