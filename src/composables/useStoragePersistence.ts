import { computed, ref } from 'vue'

const DISMISSED_KEY = 'chronicle:storage-notice-dismissed'

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Whether the browser said no to keeping Chronicle's storage through its own clean-ups. */
const refused = ref(false)
const dismissed = ref(readDismissed())

/**
 * Asks the browser to keep this site's storage, IndexedDB and OPFS alike, out of the eviction it
 * runs when space is short. Browsers answer on their own terms: Chromium grants it to installed
 * apps without asking, and Firefox asks the writer. It never protects against someone clearing
 * the site's data, which only a backup outside the browser can.
 */
export async function requestPersistentStorage(): Promise<void> {
  const storage = globalThis.navigator?.storage
  // Only a refusal is worth a word: unsupported browsers have nothing to offer instead.
  if (!storage?.persist) return

  try {
    refused.value = !(await storage.persist())
  } catch {
    refused.value = true
  }
}

/** Whether the writer should be told the browser refused, until they dismiss it. */
export function useStoragePersistence() {
  const showNotice = computed(() => refused.value && !dismissed.value)

  function dismiss(): void {
    dismissed.value = true
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Remembering the dismissal is a convenience; without storage it lasts this visit.
    }
  }

  return { showNotice, dismiss }
}
