import { InMemoryDraftRepository } from '@/repositories/inMemoryDraftRepository'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { runDraftRepositoryContract } from '@/repositories/draftRepository.contract'

runDraftRepositoryContract('in-memory', () => {
  const entries = new InMemoryEntryRepository()
  return { drafts: new InMemoryDraftRepository(entries), entries }
})
