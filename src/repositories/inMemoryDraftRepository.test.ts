import { runDraftRepositoryContract } from '@/repositories/draftRepository.contract'
import { InMemoryDraftRepository } from '@/repositories/inMemoryDraftRepository'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'

runDraftRepositoryContract('in-memory', () => {
  const entries = new InMemoryEntryRepository()
  return { drafts: new InMemoryDraftRepository(entries), entries }
})
