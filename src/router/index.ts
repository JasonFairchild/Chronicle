import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import TimelineView from '@/views/TimelineView.vue'
import EntryDetailView from '@/views/EntryDetailView.vue'
import NewConnectionView from '@/views/NewConnectionView.vue'
import DraftsView from '@/views/DraftsView.vue'

/**
 * Exported separately from the router built below so tests can build their own router — real
 * routes, isolated in-memory history — instead of hand-copying a route subset. See
 * `src/testing/testRouter.ts`.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'timeline',
    component: TimelineView,
  },
  {
    path: '/drafts',
    name: 'drafts',
    component: DraftsView,
  },
  {
    path: '/entries/:id',
    name: 'entry-detail',
    component: EntryDetailView,
    props: true,
  },
  {
    path: '/entries/:id/connect',
    name: 'new-connection',
    component: NewConnectionView,
    props: true,
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
