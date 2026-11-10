import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

import type { MediaRepository } from '@/repositories/mediaRepository'
import { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'
import { freshMediaRepository, removeMediaDirectory } from '@/testing/realRepositories'

// OPFS only exists in a real browser, so this adapter is proven here and nowhere else. Each test
// gets its own directory, which `realRepositories.ts` removes after. No contract suite: no second
// media backend is planned.

/** A one-pixel PNG, small enough to read at a glance and real enough to keep its type. */
function pngBlob(): Blob {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Blob([bytes], { type: 'image/png' })
}

describe('OpfsMediaRepository', () => {
  let repository: MediaRepository

  beforeEach(() => {
    repository = freshMediaRepository()
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
    expect(await repository.get(first)).not.toBeNull()
    expect(await repository.get(second)).not.toBeNull()
  })

  it('reports a missing blob as null rather than throwing', async () => {
    expect(await repository.get('never-stored.png')).toBeNull()
  })

  it('falls back to a neutral type for bytes that are not a known image', async () => {
    const id = await repository.put(new Blob([new Uint8Array([1, 2, 3])]))

    expect(id).toMatch(/\.bin$/)
    expect((await repository.get(id))?.type).toBe('application/octet-stream')
  })
})

describe('OpfsMediaRepository persistence', () => {
  it('keeps a blob when a new instance opens the same directory', async () => {
    const directoryName = `media-persistence-${Date.now()}`
    // By name, so a failing assertion can't leave it behind.
    onTestFinished(() => removeMediaDirectory(directoryName))

    const beforeReload = new OpfsMediaRepository(directoryName)
    const id = await beforeReload.put(new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' }))

    const afterReload = new OpfsMediaRepository(directoryName)
    const recovered = await afterReload.get(id)

    expect(new Uint8Array(await recovered!.arrayBuffer())).toEqual(Uint8Array.from([7, 7, 7]))
  })
})
