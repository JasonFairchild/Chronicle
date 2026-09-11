import { InMemoryMediaRepository } from '@/repositories/inMemoryMediaRepository'
import { runMediaRepositoryContract } from '@/repositories/mediaRepository.contract'

runMediaRepositoryContract('in-memory', () => new InMemoryMediaRepository())
