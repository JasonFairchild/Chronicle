import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MARK_POLICY } from '@/domain/marks'
import type { CreateMarkSetInput } from '@/types/markSet'
import type { MarkSetRepository } from './markSetRepository'

function makeInput(overrides: Partial<CreateMarkSetInput> = {}): CreateMarkSetInput {
  return {
    entry_id: 'entry-1',
    name: 'Default',
    policy: DEFAULT_MARK_POLICY,
    base_content: '',
    frames: [],
    ...overrides,
  }
}

/** Run against every `MarkSetRepository`, for the same reason the entry contract exists. */
export function runMarkSetRepositoryContract(
  label: string,
  createRepository: () => MarkSetRepository | Promise<MarkSetRepository>,
): void {
  describe(`MarkSetRepository contract (${label})`, () => {
    let repository: MarkSetRepository

    beforeEach(async () => {
      repository = await createRepository()
    })

    it('stores a set whole and reads it back, its policy patterns included', async () => {
      const input = makeInput({
        policy: { ...DEFAULT_MARK_POLICY, triggerPatterns: [/TODO/i] },
        base_content: 'The document before the session',
        frames: [
          {
            at: 1_000,
            index: 3,
            reasons: ['punctuation'],
            net: { steps: [{ stepType: 'replace', from: 1, to: 1 }] },
            changes: [{ kind: 'removed', from: 1, to: 1, removed: 'rain' }],
          },
        ],
      })

      const created = await repository.create(input)

      expect(created.id).toBeTruthy()
      expect(await repository.get(created.id)).toEqual(created)
      expect(created).toMatchObject(input)
      expect(created.policy.triggerPatterns[0]?.test('todo: call')).toBe(true)
    })

    it('lists only the sets for the entry asked about, oldest first', async () => {
      const first = await repository.create(makeInput({ name: 'Default' }))
      await repository.create(makeInput({ entry_id: 'entry-2' }))
      const second = await repository.create(makeInput({ name: 'Sentences only' }))

      const listed = await repository.listForEntry('entry-1')

      expect(listed.map((set) => set.id)).toEqual([first.id, second.id])
    })

    it('deletes a set, since it can always be rebuilt', async () => {
      const created = await repository.create(makeInput())

      await repository.delete(created.id)

      expect(await repository.get(created.id)).toBeNull()
      expect(await repository.listForEntry('entry-1')).toEqual([])
    })
  })
}
