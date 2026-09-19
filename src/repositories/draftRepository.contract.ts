import { beforeEach, describe, expect, it } from 'vitest'
import type { Draft } from '@/types/draft'
import { emptyEntryDates } from '@/types/entry'
import type { DraftRepository, PersistedSteps } from './draftRepository'

const NOTHING_PERSISTED: PersistedSteps = { child: 0, parent: 0 }

function makeDraft(overrides: Partial<Draft> & Pick<Draft, 'session_id'>): Draft {
  return {
    target: { kind: 'new_root' },
    started_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
    dates: emptyEntryDates(),
    title: null,
    child: { content: '', steps: [], ticks: [] },
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
            content: 'Half a thought',
            steps: [{ at: 1_000, step: { stepType: 'replace' } }],
            ticks: [{ at: 1_000, step_index: 1, reasons: ['punctuation'] }],
          },
          parent: {
            content: 'The full parent document, with a provisional anchor mark',
            title: null,
            base_content: 'The full parent document, as this session found it',
            steps: [{ at: 1_000, step: { stepType: 'addMark' } }],
            ticks: [{ at: 1_000, step_index: 1, reasons: ['anchor'] }],
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
      expect(fetched?.child.steps).toHaveLength(1)
      expect(fetched?.parent?.steps).toHaveLength(1)
      expect(fetched?.child.ticks[0]?.reasons).toEqual(['punctuation'])
      expect(fetched?.parent?.ticks[0]?.reasons).toEqual(['anchor'])
    })

    it('overwrites in place, because a live session is working space rather than history', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: { content: 'It rai', steps: [], ticks: [] },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: { content: 'It rained all day.', steps: [], ticks: [] },
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

    it('lists a summary carrying the content but not the step or tick chains', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            content: 'It rai',
            steps: [{ at: 1_000, step: { n: 1 } }],
            ticks: [{ at: 1_000, step_index: 1, reasons: ['punctuation'] }],
          },
        }),
        NOTHING_PERSISTED,
      )

      const [summary] = await repository.list()
      expect(summary?.child.content).toBe('It rai')
      expect(summary?.child).not.toHaveProperty('steps')
      expect(summary?.child).not.toHaveProperty('ticks')
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
        child: { content: 'It rai', steps: [], ticks: [] },
      })

      await repository.save(draft, NOTHING_PERSISTED)
      draft.child.content = 'It rained all day, mutated after the save resolved'

      expect((await repository.getById('session-1'))?.child.content).toBe('It rai')
    })

    it('appends only the steps it has not already stored, and reads the whole chain back', async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            content: 'It rai',
            steps: [{ at: 1_000, step: { n: 1 } }],
            ticks: [],
          },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            content: 'It rained',
            steps: [
              { at: 1_000, step: { n: 1 } },
              { at: 2_000, step: { n: 2 } },
            ],
            ticks: [],
          },
        }),
        { child: 1, parent: 0 },
      )

      const fetched = await repository.getById('session-1')
      expect(fetched?.child.steps.map((step) => step.step)).toEqual([{ n: 1 }, { n: 2 }])
    })

    it("forgets a session's steps when its draft is deleted", async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            content: 'It rai',
            steps: [{ at: 1_000, step: { n: 1 } }],
            ticks: [],
          },
        }),
        NOTHING_PERSISTED,
      )
      await repository.delete('session-1')

      // Reused session id, as a fresh `beginDraft` would never produce, but the row's absence is
      // what a stale, un-cleaned-up step row would betray.
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: { content: 'Fresh start', steps: [], ticks: [] },
        }),
        NOTHING_PERSISTED,
      )

      expect((await repository.getById('session-1'))?.child.steps).toEqual([])
    })

    it("reassembles a resumed session's chain in the order it was written", async () => {
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            content: 'One',
            steps: [{ at: 1_000, step: { n: 1 } }],
            ticks: [],
          },
          parent: {
            content: 'Parent one',
            title: null,
            base_content: 'Parent base',
            steps: [{ at: 1_000, step: { n: 'p1' } }],
            ticks: [],
          },
        }),
        NOTHING_PERSISTED,
      )
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          child: {
            content: 'One two',
            steps: [
              { at: 1_000, step: { n: 1 } },
              { at: 2_000, step: { n: 2 } },
            ],
            ticks: [],
          },
          parent: {
            content: 'Parent one two',
            title: null,
            base_content: 'Parent base',
            steps: [
              { at: 1_000, step: { n: 'p1' } },
              { at: 2_000, step: { n: 'p2' } },
            ],
            ticks: [],
          },
        }),
        { child: 1, parent: 1 },
      )

      const fetched = await repository.getById('session-1')
      expect(fetched?.child.steps.map((step) => step.step)).toEqual([{ n: 1 }, { n: 2 }])
      expect(fetched?.parent?.steps.map((step) => step.step)).toEqual([{ n: 'p1' }, { n: 'p2' }])
    })
  })
}
