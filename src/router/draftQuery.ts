import { computed, type ComputedRef } from 'vue'
import { useRoute, type RouteLocationRaw } from 'vue-router'
import type { DraftSnapshot } from '@/types/draft'

/** The page a draft was started from, linked to reopen it there. */
export function draftLocation(draft: DraftSnapshot): RouteLocationRaw {
  const query = { draft: draft.session_id }

  switch (draft.kind) {
    case 'new_root':
      return { name: 'new-entry', query }
    case 'new_connection':
      return { name: 'new-connection', params: { id: draft.parent_id }, query }
    case 'revision':
    case 'new_related':
      return { name: 'entry-detail', params: { id: draft.parent_id }, query }
  }
}

/**
 * The draft this page was linked to reopen (`?draft=<session_id>`), if any. Kept in the URL, so a
 * reload reopens it too; one since saved or discarded finds nothing to reopen.
 */
export function useDraftToResume(): ComputedRef<string | null> {
  const route = useRoute()
  return computed(() => (typeof route.query.draft === 'string' ? route.query.draft : null))
}
