import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { Step, Transform } from '@tiptap/pm/transform'
import { parseDocument, type EntryDocument } from '@/domain/entryDocument'
import type { AuthoringTrace } from '@/types/entry'
import { entryExtensions } from './extensions'

/**
 * Replays a session's event log into the documents it passed through (ENTRY_MODEL.md, "Authoring
 * capture"). In the editor layer because a step only means something against a schema, and this
 * uses the editor's own. A step that no longer applies, because the schema moved on, ends replay at
 * the last whole event reached: the loss is scrubbing, never words.
 */

/** A trace, or a draft's log still in progress: whatever holds a base and the events after it. */
export type ReplayLog = Pick<AuthoringTrace, 'base_content' | 'events'>

let schema: Schema | null = null

function entrySchema(): Schema {
  schema ??= getSchema(entryExtensions())
  return schema
}

/** A stored document as a node steps can apply to, or null when it no longer fits the schema. */
export function replayDocument(content: string | EntryDocument): ProseMirrorNode | null {
  try {
    return entrySchema().nodeFromJSON(parseDocument(content))
  } catch {
    return null
  }
}

/** Applies serialized steps to `transform`, or returns false at the first that won't apply. */
export function applySteps(transform: Transform, steps: readonly unknown[]): boolean {
  try {
    for (const json of steps) {
      const step = Step.fromJSON(transform.doc.type.schema, json)
      if (transform.maybeStep(step).failed) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * The document after each of `indices` events, in one pass: 0 is the base, and `events.length` is
 * the finished document. `indices` must be ascending. Shorter than `indices` when replay stopped
 * early.
 */
export function documentsAt(log: ReplayLog, indices: readonly number[]): EntryDocument[] {
  const base = replayDocument(log.base_content)
  if (!base) return []

  const transform = new Transform(base)
  const reached: EntryDocument[] = []
  let next = 0

  const collect = (index: number) => {
    for (; indices[next] === index; next++) reached.push(transform.doc.toJSON() as EntryDocument)
  }

  collect(0)
  for (const [i, event] of log.events.entries()) {
    if (next === indices.length) break
    if (event.kind === 'edit' && !applySteps(transform, event.steps)) break
    collect(i + 1)
  }

  return reached
}
