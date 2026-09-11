import { afterEach, describe, expect, it } from 'vitest'
import { runMediaRepositoryContract } from '@/repositories/mediaRepository.contract'
import { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'

// OPFS only exists in a real browser, so this adapter is proven here and nowhere else. Each test
// gets its own directory, and every one is removed afterwards so a run leaves no files behind.
let directoryCounter = 0
const opened: OpfsMediaRepository[] = []

function freshRepository(): OpfsMediaRepository {
  const repository = new OpfsMediaRepository(`media-test-${Date.now()}-${directoryCounter++}`)
  opened.push(repository)
  return repository
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((repository) => repository.dispose()))
})

runMediaRepositoryContract('OPFS', () => freshRepository())

describe('OpfsMediaRepository persistence', () => {
  it('keeps a blob when a new instance opens the same directory', async () => {
    const directoryName = `media-persistence-${Date.now()}`
    const beforeReload = new OpfsMediaRepository(directoryName)
    const id = await beforeReload.put(new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' }))

    const afterReload = new OpfsMediaRepository(directoryName)
    const recovered = await afterReload.get(id)

    expect(new Uint8Array(await recovered!.arrayBuffer())).toEqual(Uint8Array.from([7, 7, 7]))

    await afterReload.dispose()
  })
})
