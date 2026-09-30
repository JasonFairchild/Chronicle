import { beforeEach, describe, expect, it } from 'vitest'
import { StaleVersionError } from '@/domain/entryValidation'
import { makeDraft, relatedTo } from '@/testing/draftFixtures'
import { createEntryInput, type AuthoringEvent } from '@/types/entry'
import { DraftConflictError, type DraftRepository, type PersistedEvents } from './draftRepository'
import type { EntryRepository } from './entryRepository'

const NOTHING_PERSISTED: PersistedEvents = { entry: 0, parent: 0 }

/** A draft repository with the entry repository its seals write into. */
export interface DraftStorage {
  drafts: DraftRepository
  entries: EntryRepository
}

/**
 * One behavioral contract, run against every `DraftRepository` implementation, for the same reason
 * the entry contract exists: swapping the storage engine has to be a one-line change, and that is
 * only true if both adapters are held to the identical definition of correct.
 */
export function runDraftRepositoryContract(
  label: string,
  createStorage: () => DraftStorage | Promise<DraftStorage>,
): void {
  describe(`DraftRepository contract (${label})`, () => {
    let repository: DraftRepository
    let entries: EntryRepository

    beforeEach(async () => {
      ;({ drafts: repository, entries } = await createStorage())
    })

    it('seals a draft into its entries and removes it, as one write', async () => {
      await repository.save(
        makeDraft('session-1', { entry: { content: 'Finished' } }),
        NOTHING_PERSISTED,
      )

      const [sealed] = await repository.seal('session-1', [
        createEntryInput({ content: 'Finished' }),
      ])

      expect((await entries.getById(sealed!.id))?.content).toBe('Finished')
      expect(await repository.getById('session-1')).toBeNull()
    })

    it('leaves the draft exactly as it was when its entries are refused', async () => {
      const root = await entries.create(createEntryInput({ content: 'One' }))
      const staleRevision = () =>
        createEntryInput({
          content: 'Two, from a stale start',
          parent_id: root.id,
          relation_type: 'revision',
          base_version_id: root.id,
        })
      await entries.create(staleRevision())
      const draft = makeDraft('session-1', {
        entry: {
          title: 'Second go',
          content: 'Two, from a stale start',
          events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }],
        },
      })
      await repository.save(draft, NOTHING_PERSISTED)

      await expect(repository.seal('session-1', [staleRevision()])).rejects.toThrow(
        StaleVersionError,
      )

      expect(await repository.getById('session-1')).toEqual(draft)
      expect(await entries.listRevisions(root.id)).toHaveLength(1)
    })

    it('returns the entries it seals in the order it was given them', async () => {
      const root = await entries.create(createEntryInput({ content: 'One' }))
      await repository.save(makeDraft('session-1'), NOTHING_PERSISTED)

      // An anchor-mode seal: the parent's revision, then the related entry, which the caller
      // tells apart by position alone.
      const sealed = await repository.seal('session-1', [
        createEntryInput({
          content: 'One, marked',
          parent_id: root.id,
          relation_type: 'revision',
          base_version_id: root.id,
        }),
        createEntryInput({ content: 'About one', parent_id: root.id, relation_type: 'annotation' }),
      ])

      expect(sealed.map((entry) => entry.content)).toEqual(['One, marked', 'About one'])
    })

    it('saves a draft and reads it back whole', async () => {
      await repository.save(
        makeDraft('session-1', {
          entry: {
            dates: {
              recorded_at: '1994-06-12',
              recorded_time_note: 'evening',
              occurred_at: '1994-06-11',
              occurred_time_note: 'morning',
            },
            title: 'Lake Tahoe',
            content: 'Half a thought',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 1 }], inserted_text: 'Half a thought' },
              { kind: 'manual', at: 1_500 },
            ],
          },
          kind: relatedTo(
            { id: 'entry-9', content: 'The full parent document, as this session found it' },
            {
              content: 'The full parent document, with a provisional anchor mark',
              events: [{ kind: 'edit', at: 1_000, steps: [{ n: 'p1' }], is_anchor_op: true }],
            },
          ),
        }),
        NOTHING_PERSISTED,
      )

      const fetched = await repository.getById('session-1')
      if (fetched?.kind !== 'new_related') throw new Error('Expected a related-entry draft')

      expect(fetched.entry.content).toBe('Half a thought')
      expect(fetched.entry.title).toBe('Lake Tahoe')
      expect(fetched.parent_id).toBe('entry-9')
      expect(fetched.entry.dates).toEqual({
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'morning',
      })
      expect(fetched.parent.base_content).toBe('The full parent document, as this session found it')
      expect(fetched.parent.content).toBe(
        'The full parent document, with a provisional anchor mark',
      )
      expect(fetched.entry.events).toEqual([
        { kind: 'edit', at: 1_000, steps: [{ n: 1 }], inserted_text: 'Half a thought' },
        { kind: 'manual', at: 1_500 },
      ])
      expect(fetched.parent.events).toEqual([
        { kind: 'edit', at: 1_000, steps: [{ n: 'p1' }], is_anchor_op: true },
      ])
    })

    it('overwrites in place, because a live session is working space rather than history', async () => {
      await repository.save(
        makeDraft('session-1', { entry: { content: 'It rai' } }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'It rained all day.' },
          updatedAt: '2026-09-05T10:00:05.000Z',
        }),
        NOTHING_PERSISTED,
      )

      expect(await repository.list()).toHaveLength(1)
      expect((await repository.getById('session-1'))?.entry.content).toBe('It rained all day.')
    })

    it('lists drafts most recently touched first', async () => {
      await repository.save(
        makeDraft('older', { updatedAt: '2026-09-05T10:00:00.000Z' }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft('newer', { updatedAt: '2026-09-05T11:00:00.000Z' }),
        NOTHING_PERSISTED,
      )

      expect((await repository.list()).map((draft) => draft.session_id)).toEqual(['newer', 'older'])
    })

    it('lists drafts touched in the same millisecond later-begun first', async () => {
      // Session ids are time-ordered, so the later one sorts last as text.
      const touchedAt = '2026-09-05T10:00:00.000Z'
      await repository.save(makeDraft('session-1', { updatedAt: touchedAt }), NOTHING_PERSISTED)
      await repository.save(makeDraft('session-2', { updatedAt: touchedAt }), NOTHING_PERSISTED)

      expect((await repository.list()).map((draft) => draft.session_id)).toEqual([
        'session-2',
        'session-1',
      ])
    })

    it('lists a snapshot carrying the content but not the event log', async () => {
      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'It rai', events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }] },
        }),
        NOTHING_PERSISTED,
      )

      const [snapshot] = await repository.list()
      expect(snapshot?.entry.content).toBe('It rai')
      expect(snapshot?.entry).not.toHaveProperty('events')
    })

    it('deletes a draft, which is what sealing does once the entry is committed', async () => {
      await repository.save(makeDraft('session-1'), NOTHING_PERSISTED)
      await repository.delete('session-1')

      expect(await repository.getById('session-1')).toBeNull()
      expect(await repository.list()).toEqual([])
    })

    it('returns null for a session it has never seen', async () => {
      expect(await repository.getById('never-existed')).toBeNull()
    })

    it("does not keep the caller's object, so a session that keeps typing cannot rewrite what it stored", async () => {
      const draft = makeDraft('session-1', { entry: { content: 'It rai' } })

      await repository.save(draft, NOTHING_PERSISTED)
      draft.entry.content = 'It rained all day, mutated after the save resolved'

      expect((await repository.getById('session-1'))?.entry.content).toBe('It rai')
    })

    it('appends only the events it has not already stored, and reads the whole log back', async () => {
      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'It rai', events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }] },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft('session-1', {
          entry: {
            content: 'It rained',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 1 }] },
              { kind: 'edit', at: 2_000, steps: [{ n: 2 }] },
            ],
          },
        }),
        { entry: 1, parent: 0 },
      )

      const fetched = await repository.getById('session-1')
      expect(fetched?.entry.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })

    it('refuses to append over events already stored, so two tabs cannot interleave one log', async () => {
      const first: AuthoringEvent = { kind: 'edit', at: 1_000, steps: [{ n: 1 }] }
      await repository.save(
        makeDraft('session-1', { entry: { content: 'One', events: [first] } }),
        NOTHING_PERSISTED,
      )
      // Two tabs both loaded one event. This one appends its second first...
      await repository.save(
        makeDraft('session-1', {
          entry: {
            content: 'One two',
            events: [first, { kind: 'edit', at: 2_000, steps: [{ n: 2 }] }],
          },
        }),
        { entry: 1, parent: 0 },
      )

      // ...and the other, still believing one is stored, appends a different second.
      await expect(
        repository.save(
          makeDraft('session-1', {
            entry: {
              content: 'One three',
              events: [first, { kind: 'edit', at: 3_000, steps: [{ n: 3 }] }],
            },
          }),
          { entry: 1, parent: 0 },
        ),
      ).rejects.toThrow(DraftConflictError)

      const fetched = await repository.getById('session-1')
      expect(fetched?.entry.content).toBe('One two')
      expect(fetched?.entry.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })

    it('refuses a save that conflicts on the parent log alone, writing none of it', async () => {
      const parent = { id: 'entry-9', content: 'Parent base' }
      const typed: AuthoringEvent = { kind: 'edit', at: 1_000, steps: [{ n: 1 }] }
      const marked: AuthoringEvent = { kind: 'edit', at: 1_000, steps: [{ n: 'p1' }] }
      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'One', events: [typed] },
          kind: relatedTo(parent, { content: 'Parent one', events: [marked] }),
        }),
        NOTHING_PERSISTED,
      )
      // Two tabs both loaded both logs. This one marks the parent again first...
      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'One', events: [typed] },
          kind: relatedTo(parent, {
            content: 'Parent one two',
            events: [marked, { kind: 'edit', at: 2_000, steps: [{ n: 'p2' }] }],
          }),
        }),
        { entry: 1, parent: 1 },
      )

      // ...and the other marks it differently and types on, an append the entry log alone would
      // have taken.
      await expect(
        repository.save(
          makeDraft('session-1', {
            entry: {
              content: 'One three',
              events: [typed, { kind: 'edit', at: 3_000, steps: [{ n: 3 }] }],
            },
            kind: relatedTo(parent, {
              content: 'Parent one three',
              events: [marked, { kind: 'edit', at: 3_000, steps: [{ n: 'p3' }] }],
            }),
          }),
          { entry: 1, parent: 1 },
        ),
      ).rejects.toThrow(DraftConflictError)

      const fetched = await repository.getById('session-1')
      if (fetched?.kind !== 'new_related') throw new Error('Expected a related-entry draft')
      expect(fetched.entry.content).toBe('One')
      expect(fetched.entry.events.map((event) => event.at)).toEqual([1_000])
      expect(fetched.parent.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })

    it('takes a save with no events to append, even over a log another tab has added to', async () => {
      const first: AuthoringEvent = { kind: 'edit', at: 1_000, steps: [{ n: 1 }] }
      await repository.save(
        makeDraft('session-1', { entry: { content: 'One', events: [first] } }),
        NOTHING_PERSISTED,
      )
      // Another tab types on...
      await repository.save(
        makeDraft('session-1', {
          entry: {
            content: 'One two',
            events: [first, { kind: 'edit', at: 2_000, steps: [{ n: 2 }] }],
          },
        }),
        { entry: 1, parent: 0 },
      )

      // ...and this one, still at one event, changes only the title. With no index to collide on,
      // it lands over the other's snapshot: the gap AUTHORING.md accepts ("One draft, many tabs"),
      // since writing here takes focus, and a tab return catches up with disk first.
      await repository.save(
        makeDraft('session-1', { entry: { title: 'Retitled', content: 'One', events: [first] } }),
        { entry: 1, parent: 0 },
      )

      const fetched = await repository.getById('session-1')
      expect(fetched?.entry.title).toBe('Retitled')
      expect(fetched?.entry.content).toBe('One')
      expect(fetched?.entry.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })

    it("forgets a session's events when its draft is deleted", async () => {
      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'It rai', events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }] },
        }),
        NOTHING_PERSISTED,
      )
      await repository.delete('session-1')

      // Reused session id, as a fresh `beginDraft` would never produce, but the row's absence is
      // what a stale, un-cleaned-up event row would betray.
      await repository.save(
        makeDraft('session-1', { entry: { content: 'Fresh start' } }),
        NOTHING_PERSISTED,
      )

      expect((await repository.getById('session-1'))?.entry.events).toEqual([])
    })

    it("reassembles a resumed session's logs in the order they were written", async () => {
      const parent = { id: 'entry-9', content: 'Parent base' }

      await repository.save(
        makeDraft('session-1', {
          entry: { content: 'One', events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }] },
          kind: relatedTo(parent, {
            content: 'Parent one',
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 'p1' }] }],
          }),
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft('session-1', {
          entry: {
            content: 'One two',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 1 }] },
              { kind: 'manual', at: 2_000 },
            ],
          },
          kind: relatedTo(parent, {
            content: 'Parent one two',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 'p1' }] },
              { kind: 'edit', at: 2_000, steps: [{ n: 'p2' }] },
            ],
          }),
        }),
        { entry: 1, parent: 1 },
      )

      const fetched = await repository.getById('session-1')
      if (fetched?.kind !== 'new_related') throw new Error('Expected a related-entry draft')

      expect(fetched.entry.events.map((event) => event.kind)).toEqual(['edit', 'manual'])
      expect(fetched.parent.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })
  })
}
