import { describe, expect, it, onTestFinished } from 'vitest'

import { runMediaRepositoryContract } from '@/repositories/mediaRepository.contract'
import { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'
import { freshMediaRepository, removeMediaDirectory } from '@/testing/realRepositories'

// OPFS only exists in a real browser, so this adapter is proven here and nowhere else. Each test
// gets its own directory, which `realRepositories.ts` removes after.
runMediaRepositoryContract('OPFS', () => freshMediaRepository())

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
