import { InMemoryMarkSetRepository } from '@/repositories/inMemoryMarkSetRepository'
import { runMarkSetRepositoryContract } from '@/repositories/markSetRepository.contract'

runMarkSetRepositoryContract('in-memory', () => new InMemoryMarkSetRepository())
