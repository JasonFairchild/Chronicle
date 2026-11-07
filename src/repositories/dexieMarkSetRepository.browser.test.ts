import { runMarkSetRepositoryContract } from '@/repositories/markSetRepository.contract'
import { freshMarkSetRepository } from '@/testing/realRepositories'

// Real IndexedDB, as for the other Dexie adapters; `realRepositories.ts` deletes it after.
runMarkSetRepositoryContract('Dexie', () => freshMarkSetRepository())
