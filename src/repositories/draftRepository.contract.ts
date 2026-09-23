import { beforeEach, describe, expect, it } from 'vitest'
import type { Draft } from '@/types/draft'
import { emptyEntryDates } from '@/types/entry'
import type { DraftRepository, PersistedEvents } from './draftRepository'

const NOTHING_PERSISTED: PersistedEvents = { child: 0, parent: 0 }

function makeDraft(overrides: Partial<Draft> & Pick<Draft, 'session_id'>): Draft {
  return {
    target: { kind: 'new_root' },
    started_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
    dates: emptyEntryDates(),
    title: null,
    child: { base_content: '', content: '', events: [] },
    parent: null,
    ...overrides,
  }
}

/**
 * One behavioral contract, run against every `DraftRepository` implementation, for the same reason
 * the entry contract exists: swapping the storage engine has to be a one-line change, and that is
 * only true if both adapters are held to the identical definition of correct.
 */
export function runDraftRepositoryContract(
  label: string,
  createRepository: () => DraftRepository | Promise<DraftRepository>,
): void {
  describe(`DraftRepository contract (${label})`, () => {
    let repository: DraftRepository

    beforeEach(async () => {
      repository = await createRepository()
    })

    it('saves a draft and reads it back whole', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          target: { kind: 'new_child', parent_id: 'entry-9' },
          dates: {
            recorded_at: '1994-06-12',
            recorded_time_note: 'evening',
            occurred_at: '1994-06-11',
            occurred_time_note: 'morning',
          },
          title: 'Lake Tahoe',
          child: {
            base_content: '',
            content: 'Half a thought',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 1 }], inserted_text: 'Half a thought' },
              { kind: 'manual', at: 1_500 },
            ],
          },
          parent: {
            base_content: 'The full parent document, as this session found it',
            content: 'The full parent document, with a provisional anchor mark',
            title: null,
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 'p1' }], is_anchor_op: true }],
          },
        }),
        NOTHING_PERSISTED,
      )

      const fetched = await repository.getById('session-1')

      expect(fetched?.child.content).toBe('Half a thought')
      expect(fetched?.title).toBe('Lake Tahoe')
      expect(fetched?.target).toEqual({ kind: 'new_child', parent_id: 'entry-9' })
      expect(fetched?.dates).toEqual({
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'morning',
      })
      expect(fetched?.parent?.base_content).toBe(
        'The full parent document, as this session found it',
      )
      expect(fetched?.parent?.content).toBe(
        'The full parent document, with a provisional anchor mark',
      )
      expect(fetched?.child.events).toEqual([
        { kind: 'edit', at: 1_000, steps: [{ n: 1 }], inserted_text: 'Half a thought' },
        { kind: 'manual', at: 1_500 },
      ])
      expect(fetched?.parent?.events).toEqual([
        { kind: 'edit', at: 1_000, steps: [{ n: 'p1' }], is_anchor_op: true },
      ])
    })

    it('overwrites in place, because a live session is working space rather than history', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: { base_content: '', content: 'It rai', events: [] },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: { base_content: '', content: 'It rained all day.', events: [] },
          updated_at: '2026-09-05T10:00:05.000Z',
        }),
        NOTHING_PERSISTED,
      )

      expect(await repository.list()).toHaveLength(1)
      expect((await repository.getById('session-1'))?.child.content).toBe('It rained all day.')
    })

    it('lists drafts most recently touched first', async () => {
      await repository.save(
        makeDraft({ session_id: 'older', updated_at: '2026-09-05T10:00:00.000Z' }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({ session_id: 'newer', updated_at: '2026-09-05T11:00:00.000Z' }),
        NOTHING_PERSISTED,
      )

      expect((await repository.list()).map((draft) => draft.session_id)).toEqual(['newer', 'older'])
    })

    it('lists a summary carrying the content but not the event log', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            base_content: '',
            content: 'It rai',
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }],
          },
        }),
        NOTHING_PERSISTED,
      )

      const [summary] = await repository.list()
      expect(summary?.child.content).toBe('It rai')
      expect(summary?.child).not.toHaveProperty('events')
    })

    it('deletes a draft, which is what sealing does once the entry is committed', async () => {
      await repository.save(makeDraft({ session_id: 'session-1' }), NOTHING_PERSISTED)
      await repository.delete('session-1')

      expect(await repository.getById('session-1')).toBeNull()
      expect(await repository.list()).toEqual([])
    })

    it('returns null for a session it has never seen', async () => {
      expect(await repository.getById('never-existed')).toBeNull()
    })

    it("does not keep the caller's object, so a session that keeps typing cannot rewrite what it stored", async () => {
      const draft = makeDraft({
        session_id: 'session-1',
        child: { base_content: '', content: 'It rai', events: [] },
      })

      await repository.save(draft, NOTHING_PERSISTED)
      draft.child.content = 'It rained all day, mutated after the save resolved'

      expect((await repository.getById('session-1'))?.child.content).toBe('It rai')
    })

    it('appends only the events it has not already stored, and reads the whole log back', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            base_content: '',
            content: 'It rai',
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }],
          },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            base_content: '',
            content: 'It rained',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 1 }] },
              { kind: 'edit', at: 2_000, steps: [{ n: 2 }] },
            ],
          },
        }),
        { child: 1, parent: 0 },
      )

      const fetched = await repository.getById('session-1')
      expect(fetched?.child.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })

    it("forgets a session's events when its draft is deleted", async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            base_content: '',
            content: 'It rai',
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }],
          },
        }),
        NOTHING_PERSISTED,
      )
      await repository.delete('session-1')

      // Reused session id, as a fresh `beginDraft` would never produce, but the row's absence is
      // what a stale, un-cleaned-up event row would betray.
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: { base_content: '', content: 'Fresh start', events: [] },
        }),
        NOTHING_PERSISTED,
      )

      expect((await repository.getById('session-1'))?.child.events).toEqual([])
    })

    it("reassembles a resumed session's logs in the order they were written", async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            base_content: '',
            content: 'One',
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 1 }] }],
          },
          parent: {
            base_content: 'Parent base',
            content: 'Parent one',
            title: null,
            events: [{ kind: 'edit', at: 1_000, steps: [{ n: 'p1' }] }],
          },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            base_content: '',
            content: 'One two',
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 1 }] },
              { kind: 'manual', at: 2_000 },
            ],
          },
          parent: {
            base_content: 'Parent base',
            content: 'Parent one two',
            title: null,
            events: [
              { kind: 'edit', at: 1_000, steps: [{ n: 'p1' }] },
              { kind: 'edit', at: 2_000, steps: [{ n: 'p2' }] },
            ],
          },
        }),
        { child: 1, parent: 1 },
      )

      const fetched = await repository.getById('session-1')
      expect(fetched?.child.events.map((event) => event.kind)).toEqual(['edit', 'manual'])
      expect(fetched?.parent?.events.map((event) => event.at)).toEqual([1_000, 2_000])
    })
  })
}
