export type EntryType = 'text' | 'image'

export type RelationType = 'annotation' | 'connection' | 'update'

export interface Entry {
  id: string
  created_at: string // date the entry was added to Chronicle; Automatically handled and immutable
  // Following two dates will be user input
  recorded_at?: string | null // date the record was originally recorded; Null if the entry was created directly in app
  occurred_at?: string | null // date the event being recorded occurred if known
  parent_id: string | null
  relation_type: RelationType | null
  type: EntryType
  content: string
  media_refs: string[]
  metadata: Record<string, unknown>
  /** Target entry for connection relations */
  target_id: string | null
}

export type CreateEntryInput = Omit<Entry, 'id' | 'created_at'>

export interface AggregatedEntry {
  id: string
  type: EntryType
  content: string
  created_at: string
  media_refs: string[]
  metadata: Record<string, unknown>
  applied_relations: RelationType[]
}

export function createEntryInput(
  partial: Partial<CreateEntryInput> & Pick<CreateEntryInput, 'type' | 'content'>,
): CreateEntryInput {
  return {
    parent_id: null,
    relation_type: null,
    media_refs: [],
    metadata: {},
    target_id: null,
    ...partial,
  }
}

export function newEntryId(): string {
  return crypto.randomUUID()
}

export function newEntryTimestamp(): string {
  return new Date().toISOString()
}
