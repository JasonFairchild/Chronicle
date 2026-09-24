import { ChangeSet } from '@tiptap/pm/changeset'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  AddMarkStep,
  AttrStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Transform,
  type Step,
} from '@tiptap/pm/transform'
import { ANCHOR_INSERT_NODE, ANCHOR_MARK, type EntryDocument } from '@/domain/entryDocument'
import type { AuthoringMark } from '@/domain/marks'
import type { FrameChange, MarkFrame, MarkSet } from '@/types/markSet'
import { applySteps, replayDocument, type ReplayLog } from './replay'

/**
 * Frames for a mark set (ENTRY_MODEL.md, "Mark sets"): what changed between one mark's document
 * and the next, built once from the raw log and viewed without it.
 */

/** Whether `step` turns `before` into exactly `after`: each frame's build-time check. */
export type NetStepCheck = (step: Step, before: ProseMirrorNode, after: ProseMirrorNode) => boolean

function reproduces(step: Step, before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  try {
    return step.apply(before).doc?.eq(after) ?? false
  } catch {
    return false
  }
}

/**
 * One frame per mark, in a single replay pass over the log. Stops at the last mark replay reaches.
 * `check` is a parameter only so a test can fail it.
 */
export function buildFrames(
  log: ReplayLog,
  marks: readonly AuthoringMark[],
  check: NetStepCheck = reproduces,
): MarkFrame[] {
  const base = replayDocument(log.base_content)
  if (!base) return []

  let previous = base
  const frames: MarkFrame[] = []
  let applied = 0

  for (const mark of marks) {
    const segment = new Transform(previous)
    for (; applied < mark.index; applied++) {
      const event = log.events[applied]
      if (event.kind === 'edit' && !applySteps(segment, event.steps)) return frames
    }

    const { at, index, reasons } = mark
    frames.push({ at, index, reasons: [...reasons], ...frameOf(segment, check) })
    previous = segment.doc
  }

  return frames
}

/**
 * The document at each frame, rebuilt from `base_content` by applying each frame's net change in
 * turn: one step per mark, not the raw log's thousands. Stops where a step no longer applies, as
 * replay does.
 */
export function documentsFromFrames(
  set: Pick<MarkSet, 'base_content' | 'frames'>,
): EntryDocument[] {
  let doc = replayDocument(set.base_content)
  const documents: EntryDocument[] = []

  for (const { net } of set.frames) {
    if (!doc) break

    if ('document' in net) {
      doc = replayDocument(net.document)
    } else {
      const transform = new Transform(doc)
      doc = applySteps(transform, net.steps) ? transform.doc : null
    }

    if (doc) documents.push(doc.toJSON() as EntryDocument)
  }

  return documents
}

/**
 * A segment's net change and what to highlight. A net step that fails `check` is stored as the
 * whole document instead, so every frame is right by construction.
 */
function frameOf(segment: Transform, check: NetStepCheck): Pick<MarkFrame, 'net' | 'changes'> {
  const { before, doc: after } = segment
  const diff = differingRange(before, after)
  if (!diff) return { net: { steps: [] }, changes: [] }

  const step = new ReplaceStep(diff.start, diff.endA, after.slice(diff.start, diff.endB))

  return {
    net: check(step, before, after)
      ? { steps: [step.toJSON()] }
      : { document: after.toJSON() as EntryDocument },
    changes: changesIn(segment, diff.start, diff.endB),
  }
}

/** ProseMirror's own diff of two documents, or null when they're the same. */
function differingRange(a: ProseMirrorNode, b: ProseMirrorNode) {
  const start = a.content.findDiffStart(b.content)
  if (start === null) return null

  let { a: endA, b: endB } = a.content.findDiffEnd(b.content)!
  // Repeated text lets the two scans cross, as typing "a" into "aa" does.
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }

  return { start, endA, endB }
}

/**
 * What to highlight, read from the segment's steps. Text and nodes come from `ChangeSet`, which
 * cancels out anything typed and deleted again. Mark, attribute and rewrapping steps don't read as
 * a change there, so each one's range is mapped forward and clipped to where the documents differ:
 * outside that, it was undone.
 */
function changesIn(segment: Transform, differFrom: number, differTo: number): FrameChange[] {
  const { before, doc: after, steps, docs, mapping } = segment
  const changes: FrameChange[] = []

  for (const change of ChangeSet.create(before).addSteps(after, mapping.maps, null).changes) {
    const at = change.fromB

    const deleted = visibleIn(before, change.fromA, change.toA)
    if (deleted === 'content') {
      const removed = before.textBetween(change.fromA, change.toA, '\n')
      changes.push({ kind: 'removed', from: at, to: at, removed })
    }
    if (deleted === 'anchor') changes.push({ kind: 'anchor', from: at, to: at })

    const inserted = visibleIn(after, change.fromB, change.toB)
    if (inserted) {
      const kind = inserted === 'content' ? 'added' : 'anchor'
      changes.push({ kind, from: change.fromB, to: change.toB })
    }
  }

  steps.forEach((step, i) => {
    const touched = touchedBy(step, docs[i])
    if (!touched) return

    const forward = mapping.slice(i)
    const from = Math.max(forward.map(touched.from, 1), differFrom)
    const to = Math.min(forward.map(touched.to, -1), differTo)
    if (from < to) changes.push({ kind: touched.kind, from, to })
  })

  return tidy(changes)
}

/**
 * What a reader would see in a range: words or media, only anchor wording, or nothing, as when a
 * paragraph splits or a block is rewrapped.
 */
function visibleIn(doc: ProseMirrorNode, from: number, to: number): 'content' | 'anchor' | null {
  let seen: 'content' | 'anchor' | null = null
  if (from >= to) return seen

  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === ANCHOR_INSERT_NODE) seen ??= 'anchor'
    else if (node.isLeaf) seen = 'content'
  })

  return seen
}

/** The range a mark, attribute or rewrapping step touched, in the document it applied to. */
function touchedBy(
  step: Step,
  doc: ProseMirrorNode,
): { kind: 'formatted' | 'anchor'; from: number; to: number } | null {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    const kind = step.mark.type.name === ANCHOR_MARK ? 'anchor' : 'formatted'
    return { kind, from: step.from, to: step.to }
  }

  // A wording box's keystrokes, chiefly.
  if (step instanceof AttrStep) {
    const node = doc.nodeAt(step.pos)
    if (!node) return null
    const kind = node.type.name === ANCHOR_INSERT_NODE ? 'anchor' : 'formatted'
    return { kind, from: step.pos, to: step.pos + node.nodeSize }
  }

  // A heading, a list or a quote.
  if (step instanceof ReplaceAroundStep) return { kind: 'formatted', from: step.from, to: step.to }

  return null
}

/**
 * In document order, with overlapping or touching ranges of one kind joined: an anchor's marked
 * text and its wording node, say. Removals stay apart, since each carries its own text.
 */
function tidy(changes: FrameChange[]): FrameChange[] {
  const tidied: FrameChange[] = []
  const lastOfKind = new Map<FrameChange['kind'], FrameChange>()

  for (const change of [...changes].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = lastOfKind.get(change.kind)
    if (last && change.kind !== 'removed' && change.from <= last.to) {
      last.to = Math.max(last.to, change.to)
    } else {
      tidied.push(change)
      lastOfKind.set(change.kind, change)
    }
  }

  return tidied
}
