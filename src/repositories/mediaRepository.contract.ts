import { beforeEach, describe, expect, it } from 'vitest'
import type { MediaRepository } from './mediaRepository'

/** A one-pixel PNG, small enough to read at a glance and real enough to keep its type. */
function pngBlob(): Blob {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Blob([bytes], { type: 'image/png' })
}

/**
 * One behavioral contract for every `MediaRepository`. In-memory backs node tests, OPFS backs the
 * app; holding both to the same assertions is what makes the swap trustworthy.
 */
export function runMediaRepositoryContract(
  label: string,
  createRepository: () => MediaRepository | Promise<MediaRepository>,
): void {
  describe(`MediaRepository contract (${label})`, () => {
    let repository: MediaRepository

    beforeEach(async () => {
      repository = await createRepository()
    })

    it('stores bytes and returns them with their type intact', async () => {
      const id = await repository.put(pngBlob())
      const stored = await repository.get(id)

      expect(id).toMatch(/\.png$/)
      expect(stored?.type).toBe('image/png')
      expect(new Uint8Array((await stored!.arrayBuffer()).slice(0, 4))).toEqual(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      )
    })

    it('gives every blob its own id, so storing the same image twice keeps both', async () => {
      const first = await repository.put(pngBlob())
      const second = await repository.put(pngBlob())

      expect(first).not.toBe(second)
      expect(await repository.list()).toHaveLength(2)
    })

    it('deletes a blob and reports a missing one as null rather than throwing', async () => {
      const id = await repository.put(pngBlob())
      await repository.delete(id)

      expect(await repository.get(id)).toBeNull()
      expect(await repository.get('never-stored.png')).toBeNull()
      // Deleting something already gone is the outcome the caller asked for.
      await expect(repository.delete(id)).resolves.toBeUndefined()
    })

    it('falls back to a neutral type for bytes that are not a known image', async () => {
      const id = await repository.put(new Blob([new Uint8Array([1, 2, 3])]))

      expect(id).toMatch(/\.bin$/)
      expect((await repository.get(id))?.type).toBe('application/octet-stream')
    })
  })
}
