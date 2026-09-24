import { afterEach } from 'vitest'
import { DexieMarkSetRepository } from '@/repositories/dexieMarkSetRepository'
import { runMarkSetRepositoryContract } from '@/repositories/markSetRepository.contract'

// Real IndexedDB, as for the other Dexie adapters: a database per test, deleted afterwards.
let dbCounter = 0
const opened: DexieMarkSetRepository[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((repository) => repository.dispose()))
})

runMarkSetRepositoryContract('Dexie', () => {
  const repository = new DexieMarkSetRepository(`chronicle-mark-sets-${Date.now()}-${dbCounter++}`)
  opened.push(repository)
  return repository
})
