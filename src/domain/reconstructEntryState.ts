import {
  compareEntries,
  type AggregatedEntry,
  type Entry,
  type EntryVersion,
  type ResolvedChild,
  type ResolvedConnection,
  type TitleVersion,
} from '@/types/entry'
import { resolveAnchors } from './anchors'
import { docTitle } from './entryDocument'

export interface ReconstructOptions {
  /** Reconstruct the state as it stood at this moment. Omit for current state. */
  asOf?: Date
  /** How many levels of descendants to expand. Deeper ones are still signalled by `has_children`. */
  depth?: number
}

const DEFAULT_DEPTH = 2

interface EntryIndex {
  byId: Map<string, Entry>
  childrenOf: Map<string, Entry[]>
  connectionsTo: Map<string, Entry[]>
}

interface Walk {
  index: EntryIndex
  asOfIso?: string
  /** Guards against a malformed parent cycle in stored data. */
  seen: Set<string>
}

/**
 * The ordered version chain for one entry: its original content first, then each revision.
 *
 * Only revisions write content. Annotations, updates, and connections never do, which is what keeps
 * a single fold coherent and lets a revision be applied without erasing a narrative child.
 */
export function buildEntryHistory(
  entryId: string,
  entries: Entry[],
  asOf?: Date,
): EntryVersion[] | null {
  const index = buildIndex(entries)
  return historyFor(entryId, index, asOf?.toISOString())
}

/**
 * What the entry has been called, at each point it was saved, oldest first.
 *
 * A title needs no authoring trace of its own to have a history. It lives in the document, and a
 * revision snapshots the whole document, so the version chain already records both the name and the
 * moment it was saved — this is that chain read through one field. It is the record a title is held
 * to in exchange for being a plain field rather than part of the traced editor: the value at each
 * save point, not the keystrokes between them.
 */
export function titleHistory(
  entryId: string,
  entries: Entry[],
  asOf?: Date,
): TitleVersion[] | null {
  const versions = buildEntryHistory(entryId, entries, asOf)
  if (!versions) return null

  return versions.map((version) => ({
    revision_id: version.revision_id,
    at: version.at,
    title: docTitle(version.content),
  }))
}

export function reconstructEntryState(
  entryId: string,
  entries: Entry[],
  options: ReconstructOptions = {},
): AggregatedEntry | null {
  const walk: Walk = {
    index: buildIndex(entries),
    asOfIso: options.asOf?.toISOString(),
    seen: new Set<string>(),
  }

  return aggregate(entryId, walk, options.depth ?? DEFAULT_DEPTH)
}

function buildIndex(entries: Entry[]): EntryIndex {
  const byId = new Map<string, Entry>()
  const childrenOf = new Map<string, Entry[]>()
  const connectionsTo = new Map<string, Entry[]>()

  for (const entry of entries) {
    byId.set(entry.id, entry)

    if (entry.parent_id) {
      push(childrenOf, entry.parent_id, entry)
    }

    // Gathered, never traversed: a connection's target does not make it that entry's child.
    if (entry.relation_type === 'connection' && entry.target_id) {
      push(connectionsTo, entry.target_id, entry)
    }
  }

  for (const list of childrenOf.values()) list.sort(compareEntries)
  for (const list of connectionsTo.values()) list.sort(compareEntries)

  return { byId, childrenOf, connectionsTo }
}

function push(map: Map<string, Entry[]>, key: string, entry: Entry): void {
  const list = map.get(key)
  if (list) list.push(entry)
  else map.set(key, [entry])
}

function historyFor(entryId: string, index: EntryIndex, asOfIso?: string): EntryVersion[] | null {
  const entry = index.byId.get(entryId)
  if (!entry) return null
  if (asOfIso && entry.created_at > asOfIso) return null

  const versions: EntryVersion[] = [
    {
      revision_id: null,
      at: entry.created_at,
      content: entry.content,
      media_refs: [...entry.media_refs],
      metadata: { ...entry.metadata },
    },
  ]

  const revisions = (index.childrenOf.get(entryId) ?? []).filter(
    (child) => child.relation_type === 'revision' && (!asOfIso || child.created_at <= asOfIso),
  )

  for (const revision of revisions) {
    // A revision is a full-state snapshot. Carrying content alone would silently drop the
    // entry's media on every edit.
    versions.push({
      revision_id: revision.id,
      at: revision.created_at,
      content: revision.content,
      media_refs: [...revision.media_refs],
      metadata: { ...revision.metadata },
    })
  }

  return versions
}

function aggregate(entryId: string, walk: Walk, depth: number): AggregatedEntry | null {
  const entry = walk.index.byId.get(entryId)
  if (!entry) return null
  if (walk.asOfIso && entry.created_at > walk.asOfIso) return null
  if (walk.seen.has(entryId)) return null

  const versions = historyFor(entryId, walk.index, walk.asOfIso)
  if (!versions) return null

  const current = versions[versions.length - 1]!
  const descendants = walk.index.childrenOf.get(entryId) ?? []

  walk.seen.add(entryId)

  const children = depth > 0 ? resolveChildren(descendants, current, walk, depth) : []
  const connections = depth > 0 ? resolveConnections(entryId, descendants, walk, depth) : []

  walk.seen.delete(entryId)

  return {
    id: entry.id,
    created_at: entry.created_at,
    dates: {
      recorded_at: entry.recorded_at,
      recorded_time_note: entry.recorded_time_note,
      occurred_at: entry.occurred_at,
      occurred_time_note: entry.occurred_time_note,
    },
    // The title lives in the document, so the current version is the authority on it and renaming
    // an entry is an ordinary edit. `Entry.title` is a cache written at save time for readers that
    // must not parse a document, never a second source of truth to fall back to.
    title: docTitle(current.content),
    content: current.content,
    media_refs: current.media_refs,
    metadata: current.metadata,
    version: {
      index: versions.length,
      // Counted over the whole chain, not just the part that existed at `asOf`. Scrubbing back
      // through history is the point of this field, and a truncated count could only ever say
      // "version 3 of 3" — never "version 3 of 7", which is the thing worth showing.
      total: totalVersions(entryId, walk.index),
      at: current.at,
      revision_id: current.revision_id,
    },
    children,
    connections,
  }
}

function resolveChildren(
  descendants: Entry[],
  current: EntryVersion,
  walk: Walk,
  depth: number,
): ResolvedChild[] {
  const resolved: ResolvedChild[] = []

  for (const child of descendants) {
    if (child.relation_type !== 'annotation' && child.relation_type !== 'update') continue
    if (walk.asOfIso && child.created_at > walk.asOfIso) continue

    const entry = aggregate(child.id, walk, depth - 1)
    if (!entry) continue

    resolved.push({
      entry,
      relation_type: child.relation_type,
      // Against the version being viewed, not the original: the anchors live in the parent's
      // document, so "which version" is the whole question of where they are.
      anchors: resolveAnchors(child.anchors, current.content),
      has_children: hasVisibleChildren(child.id, walk),
    })
  }

  return resolved
}

/**
 * A connection is an edge, so it surfaces on both endpoints. The direction is real and kept,
 * but the destination is not blind to a link pointing at it.
 */
function resolveConnections(
  entryId: string,
  descendants: Entry[],
  walk: Walk,
  depth: number,
): ResolvedConnection[] {
  const outgoing = descendants.filter((child) => child.relation_type === 'connection')
  const incoming = walk.index.connectionsTo.get(entryId) ?? []

  const resolved: ResolvedConnection[] = []

  for (const connection of [...outgoing, ...incoming].sort(compareEntries)) {
    if (walk.asOfIso && connection.created_at > walk.asOfIso) continue

    const direction = connection.parent_id === entryId ? 'outgoing' : 'incoming'
    const otherId = direction === 'outgoing' ? connection.target_id : connection.parent_id
    if (!otherId) continue

    const entry = aggregate(connection.id, walk, depth - 1)
    if (!entry) continue

    resolved.push({ entry, other_id: otherId, direction })
  }

  return resolved
}

/** Length of the entry's full version chain: the original, plus one per revision. */
function totalVersions(entryId: string, index: EntryIndex): number {
  const revisions = (index.childrenOf.get(entryId) ?? []).filter(
    (child) => child.relation_type === 'revision',
  )

  return revisions.length + 1
}

function hasVisibleChildren(entryId: string, walk: Walk): boolean {
  const children = walk.index.childrenOf.get(entryId) ?? []

  return children.some(
    (child) =>
      child.relation_type !== 'revision' && (!walk.asOfIso || child.created_at <= walk.asOfIso),
  )
}
