import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { runEntryRepositoryContract } from '@/repositories/entryRepository.contract'

runEntryRepositoryContract('in-memory', () => new InMemoryEntryRepository())
