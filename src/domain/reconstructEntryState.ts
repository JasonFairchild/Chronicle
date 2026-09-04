import type { AggregatedEntry, Entry, RelationType } from '@/types/entry'

function isDescendantOf(entry: Entry, rootId: string, entriesById: Map<string, Entry>): boolean {
  let current: Entry | undefined = entry
  const visited = new Set<string>()

  while (current?.parent_id) {
    if (visited.has(current.id)) return false
    visited.add(current.id)

    if (current.parent_id === rootId) return true
    current = entriesById.get(current.parent_id)
  }

  return false
}

function compareByCreatedAt(a: Entry, b: Entry): number {
  return a.created_at.localeCompare(b.created_at)
}

function applyRelation(state: AggregatedEntry, relation: Entry): AggregatedEntry {
  const relationType = relation.relation_type
  if (!relationType) return state

  switch (relationType) {
    case 'update':
      // An update supersedes the parent's content. Prior text is not lost —
      // it lives on as its own Entry, reachable by replaying with an earlier asOf.
      return {
        ...state,
        content: relation.content,
        applied_relations: [...state.applied_relations, relationType],
      }
    case 'annotation':
      return {
        ...state,
        content: state.content
          ? `${state.content}\n\n[Annotation] ${relation.content}`
          : `[Annotation] ${relation.content}`,
        applied_relations: [...state.applied_relations, relationType],
      }
    case 'connection':
      return {
        ...state,
        applied_relations: [...state.applied_relations, relationType],
      }
    default: {
      const _exhaustive: never = relationType
      return _exhaustive
    }
  }
}

export function reconstructEntryState(
  rootId: string,
  entries: Entry[],
  asOf?: Date,
): AggregatedEntry | null {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const root = entriesById.get(rootId)
  if (!root) return null

  const asOfIso = asOf?.toISOString()
  const relatedEntries = entries
    .filter((entry) => entry.id !== rootId)
    .filter((entry) => isDescendantOf(entry, rootId, entriesById))
    .filter((entry) => (asOfIso ? entry.created_at <= asOfIso : true))
    .filter((entry) => entry.relation_type !== null)
    .sort(compareByCreatedAt)

  let state: AggregatedEntry = {
    id: root.id,
    type: root.type,
    content: root.content,
    created_at: root.created_at,
    media_refs: [...root.media_refs],
    metadata: { ...root.metadata },
    applied_relations: [],
  }

  for (const relation of relatedEntries) {
    state = applyRelation(state, relation)
  }

  return state
}

export function collectAppliedRelationTypes(entries: Entry[]): RelationType[] {
  return entries
    .map((entry) => entry.relation_type)
    .filter((relation): relation is RelationType => relation !== null)
}
