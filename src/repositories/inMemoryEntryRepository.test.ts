import { runEntryRepositoryContract } from '@/repositories/entryRepository.contract'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'

runEntryRepositoryContract('in-memory', () => new InMemoryEntryRepository())
