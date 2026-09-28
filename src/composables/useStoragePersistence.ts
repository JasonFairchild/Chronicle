import { computed, ref } from 'vue'

/** Whether the browser has agreed to keep Chronicle's storage through its own clean-ups. */
export type StoragePersistence = 'unknown' | 'persisted' | 'refused' | 'unsupported'

/** The part of `navigator.storage` this reads, so a test can hand in its own. */
export type PersistableStorage = Pick<StorageManager, 'persist' | 'persisted'>

const DISMISSED_KEY = 'chronicle:storage-notice-dismissed'

const persistence = ref<StoragePersistence>('unknown')
const dismissed = ref(readDismissed())

/**
 * Asks the browser to keep this site's storage, IndexedDB and OPFS alike, out of the eviction it
 * runs when space is short. Browsers answer on their own terms: Chromium grants it to installed
 * apps without asking, and Firefox asks the writer. It never protects against someone clearing
 * the site's data, which only a backup outside the browser can.
 */
export async function requestPersistentStorage(
  storage: PersistableStorage | undefined = globalThis.navigator?.storage,
): Promise<StoragePersistence> {
  if (!storage?.persist) {
    persistence.value = 'unsupported'
    return persistence.value
  }

  try {
    const granted = (await storage.persisted()) || (await storage.persist())
    persistence.value = granted ? 'persisted' : 'refused'
  } catch {
    persistence.value = 'refused'
  }
  return persistence.value
}

/** The answer `requestPersistentStorage` got, and whether the writer should still be told. */
export function useStoragePersistence() {
  /** Only a refusal is worth a word: unsupported browsers have nothing to offer instead. */
  const showNotice = computed(() => persistence.value === 'refused' && !dismissed.value)

  function dismiss(): void {
    dismissed.value = true
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Remembering the dismissal is a convenience; without storage it lasts this visit.
    }
  }

  return { persistence, showNotice, dismiss }
}

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}
