import { createRouter, createWebHistory } from 'vue-router'
import TimelineView from '@/views/TimelineView.vue'
import EntryDetailView from '@/views/EntryDetailView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'timeline',
      component: TimelineView,
    },
    {
      path: '/entries/:id',
      name: 'entry-detail',
      component: EntryDetailView,
      props: true,
    },
  ],
})

export default router
