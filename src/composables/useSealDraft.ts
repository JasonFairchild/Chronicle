import { useRouter } from 'vue-router'

import type { DraftSession } from '@/composables/useDraftSession'

/**
 * A page's save handler for its draft session: seals the draft, then shows the entry it became on
 * that entry's page. A failure is left to throw, for `EntryComposer` to say beside its buttons.
 */
export function useSealDraft(session: DraftSession): () => Promise<void> {
  const router = useRouter()

  return async function seal(): Promise<void> {
    const saved = await session.save()
    if (saved) void router.push({ name: 'entry-detail', params: { id: saved.id } })
  }
}
