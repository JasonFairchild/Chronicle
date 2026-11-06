import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as StoragePersistence from '@/composables/useStoragePersistence'

/** A `navigator.storage` that grants persistence when asked, or doesn't. */
function stubStorage(grants: boolean) {
  const storage = { persist: vi.fn(async () => grants) }
  vi.stubGlobal('navigator', { storage })
  return storage
}

describe('requestPersistentStorage', () => {
  let persistence: typeof StoragePersistence

  // The browser's answer is module state, since the app asks once per load, so each case loads it
  // fresh.
  beforeEach(async () => {
    vi.resetModules()
    persistence = await import('@/composables/useStoragePersistence')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks the browser to keep its storage, and says nothing once it agrees', async () => {
    const storage = stubStorage(true)

    await persistence.requestPersistentStorage()

    expect(storage.persist).toHaveBeenCalledOnce()
    expect(persistence.useStoragePersistence().showNotice.value).toBe(false)
  })

  it('tells the writer when the browser refuses', async () => {
    stubStorage(false)

    await persistence.requestPersistentStorage()

    expect(persistence.useStoragePersistence().showNotice.value).toBe(true)
  })

  it('says nothing when the browser offers no way to ask', async () => {
    vi.stubGlobal('navigator', {})

    await persistence.requestPersistentStorage()

    expect(persistence.useStoragePersistence().showNotice.value).toBe(false)
  })
})
