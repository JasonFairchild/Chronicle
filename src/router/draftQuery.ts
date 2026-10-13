import { computed, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'

/**
 * The draft this page was linked to reopen (`?draft=<session_id>`), if any. Kept in the URL, so a
 * reload reopens it too; one since saved or discarded finds nothing to reopen.
 */
export function useDraftToResume(): ComputedRef<string | null> {
  const route = useRoute()
  return computed(() => (typeof route.query.draft === 'string' ? route.query.draft : null))
}
