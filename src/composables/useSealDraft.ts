import type { Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DraftSession } from '@/composables/useDraftSession'
import type { Entry } from '@/types/entry'
import { toErrorMessage } from '@/utils/format'

/**
 * A page's save handler for its draft session: seals the draft, then shows the entry it became on
 * that entry's page. It holds no state; a failure goes into the page's own `error`, the one alert
 * the page already shows for its other actions.
 */
export function useSealDraft(
  session: DraftSession,
  error: Ref<string | null>,
): () => Promise<void> {
  const router = useRouter()

  return async function seal(): Promise<void> {
    error.value = null

    try {
      const saved = await session.save()
      if (saved) void router.push({ name: 'entry-detail', params: { id: pageOf(saved) } })
    } catch (err) {
      error.value = toErrorMessage(err, 'Failed to save entry')
    }
  }
}

/** A revision is a version of its parent, not an entry with a page of its own. */
function pageOf(saved: Entry): string {
  return saved.relation_type === 'revision' && saved.parent_id ? saved.parent_id : saved.id
}
