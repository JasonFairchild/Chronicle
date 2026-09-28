import { describe, expect, it, vi } from 'vitest'
import {
  requestPersistentStorage,
  useStoragePersistence,
  type PersistableStorage,
} from '@/composables/useStoragePersistence'

function storage(persisted: boolean, grants: boolean): PersistableStorage {
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => grants),
  }
}

describe('requestPersistentStorage', () => {
  it('asks for persistence when the site does not have it yet', async () => {
    const manager = storage(false, true)

    expect(await requestPersistentStorage(manager)).toBe('persisted')
    expect(manager.persist).toHaveBeenCalledOnce()
  })

  it('does not ask again once it has been granted', async () => {
    const manager = storage(true, true)

    expect(await requestPersistentStorage(manager)).toBe('persisted')
    expect(manager.persist).not.toHaveBeenCalled()
  })

  it('reports a refusal, which is when the writer is told', async () => {
    expect(await requestPersistentStorage(storage(false, false))).toBe('refused')
    expect(useStoragePersistence().showNotice.value).toBe(true)
  })

  it('says so when the browser offers no way to ask', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported')
    expect(useStoragePersistence().showNotice.value).toBe(false)
  })
})
