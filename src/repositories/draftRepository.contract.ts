import { beforeEach, describe, expect, it } from 'vitest'
import type { Draft } from '@/types/draft'
import { emptyEntryDates } from '@/types/entry'
import type { DraftRepository } from './draftRepository'

function makeDraft(overrides: Partial<Draft> & Pick<Draft, 'session_id'>): Draft {
  return {
    target: { kind: 'new_root' },
    started_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
    content: '',
    dates: emptyEntryDates(),
    anchor_ids: [],
    parent_content: null,
    steps: [],
    parent_steps: [],
    ticks: [],
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
          content: 'Half a thought',
          dates: {
            recorded_at: '1994-06-12',
            recorded_time_note: 'evening',
            occurred_at: '1994-06-11',
            occurred_time_note: 'morning',
          },
          anchor_ids: ['anchor-1'],
          parent_content: 'The full parent document, with a provisional anchor mark',
          steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'replace' } }],
          parent_steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'addMark' } }],
          ticks: [{ at: '2026-09-05T10:00:01.000Z', step_index: 1, reason: 'punctuation' }],
        }),
      )

      const fetched = await repository.getById('session-1')

      expect(fetched?.content).toBe('Half a thought')
      expect(fetched?.target).toEqual({ kind: 'new_child', parent_id: 'entry-9' })
      expect(fetched?.dates).toEqual({
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
        occurred_at: '1994-06-11',
        occurred_time_note: 'morning',
      })
      expect(fetched?.anchor_ids).toEqual(['anchor-1'])
      expect(fetched?.parent_content).toBe(
        'The full parent document, with a provisional anchor mark',
      )
      expect(fetched?.steps).toHaveLength(1)
      expect(fetched?.parent_steps).toHaveLength(1)
      expect(fetched?.ticks[0]?.reason).toBe('punctuation')
    })

    it('overwrites in place, because a live session is working space rather than history', async () => {
      await repository.save(makeDraft({ session_id: 'session-1', content: 'It rai' }))
      await repository.save(
        makeDraft({
          session_id: 'session-1',
          content: 'It rained all day.',
          updated_at: '2026-09-05T10:00:05.000Z',
        }),
      )

      expect(await repository.list()).toHaveLength(1)
      expect((await repository.getById('session-1'))?.content).toBe('It rained all day.')
    })

    it('lists drafts most recently touched first', async () => {
      await repository.save(
        makeDraft({ session_id: 'older', updated_at: '2026-09-05T10:00:00.000Z' }),
      )
      await repository.save(
        makeDraft({ session_id: 'newer', updated_at: '2026-09-05T11:00:00.000Z' }),
      )

      expect((await repository.list()).map((draft) => draft.session_id)).toEqual(['newer', 'older'])
    })

    it('deletes a draft, which is what sealing does once the entry is committed', async () => {
      await repository.save(makeDraft({ session_id: 'session-1' }))
      await repository.delete('session-1')

      expect(await repository.getById('session-1')).toBeNull()
      expect(await repository.list()).toEqual([])
    })

    it('returns null for a session it has never seen', async () => {
      expect(await repository.getById('never-existed')).toBeNull()
    })
  })
}
