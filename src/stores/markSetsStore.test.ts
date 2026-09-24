import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Transform } from '@tiptap/pm/transform'
import { plainTextDocument, serializeDocument, textContent } from '@/domain/entryDocument'
import { DEFAULT_MARK_POLICY } from '@/domain/marks'
import { documentsFromFrames } from '@/editor/markFrames'
import { replayDocument } from '@/editor/replay'
import {
  entryRepository,
  markSetRepository,
  setEntryRepository,
  setMarkSetRepository,
} from '@/repositories'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { InMemoryMarkSetRepository } from '@/repositories/inMemoryMarkSetRepository'
import { useMarkSetsStore } from '@/stores/markSetsStore'
import { createEntryInput, type AuthoringTrace } from '@/types/entry'

/** A session that finished "It rained" with " all day.", as one edit. */
function traceOfOneSentence(): AuthoringTrace {
  const base = serializeDocument(plainTextDocument('It rained'))
  const transform = new Transform(replayDocument(base)!)
  transform.insert(10, transform.doc.type.schema.text(' all day.'))

  return {
    session_id: 'session-1',
    started_at: '2026-09-22T10:00:00.000Z',
    ended_at: '2026-09-22T10:00:05.000Z',
    base_content: base,
    events: [
      {
        kind: 'edit',
        at: 1_000,
        steps: transform.steps.map((step) => step.toJSON()),
        inserted_text: ' all day.',
      },
    ],
  }
}

describe('useMarkSetsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setEntryRepository(new InMemoryEntryRepository())
    setMarkSetRepository(new InMemoryMarkSetRepository())
  })

  function typedEntry() {
    return entryRepository.create(
      createEntryInput({
        content: textContent('It rained all day.'),
        authoring_trace: traceOfOneSentence(),
      }),
    )
  }

  it("builds a default set the first time an entry's sets are loaded, and reuses it after", async () => {
    const entry = await typedEntry()
    const store = useMarkSetsStore()

    await store.loadMarkSets(entry.id)
    const [built] = store.markSets

    expect(built?.name).toBe('Default')
    expect(built?.frames.map((frame) => frame.reasons)).toEqual([['punctuation']])
    expect(documentsFromFrames(built!)).toEqual([plainTextDocument('It rained all day.')])

    await store.loadMarkSets(entry.id)

    expect(store.markSets.map((set) => set.id)).toEqual([built?.id])
  })

  it('makes a new set beside the old one for a retuned policy, even under the same name', async () => {
    const entry = await typedEntry()
    const store = useMarkSetsStore()
    await store.loadMarkSets(entry.id)

    await store.createMarkSet(entry.id, 'Default', { ...DEFAULT_MARK_POLICY, punctuation: '' })

    expect(store.markSets.map((set) => set.frames.length)).toEqual([1, 0])
  })

  it('has no set for an entry nothing was typed into', async () => {
    const entry = await entryRepository.create(
      createEntryInput({ content: textContent('Imported') }),
    )
    const store = useMarkSetsStore()

    await store.loadMarkSets(entry.id)

    expect(store.markSets).toEqual([])
    expect(await store.createMarkSet(entry.id, 'Default')).toBeNull()
  })

  it('deletes a set, which loading simply builds again', async () => {
    const entry = await typedEntry()
    const store = useMarkSetsStore()
    await store.loadMarkSets(entry.id)
    const [built] = store.markSets

    await store.deleteMarkSet(built!.id)

    expect(store.markSets).toEqual([])
    expect(await markSetRepository.get(built!.id)).toBeNull()

    await store.loadMarkSets(entry.id)

    expect(store.markSets[0]?.frames).toEqual(built?.frames)
  })
})
