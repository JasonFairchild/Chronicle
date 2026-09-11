import { InMemoryDraftRepository } from '@/repositories/inMemoryDraftRepository'
import { runDraftRepositoryContract } from '@/repositories/draftRepository.contract'

runDraftRepositoryContract('in-memory', () => new InMemoryDraftRepository())
