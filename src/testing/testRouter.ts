import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { routes } from '@/router'

/**
 * A real router for tests: the app's real route table (see `src/router/index.ts`), on in-memory
 * history so it stays isolated per call instead of touching the actual browser URL.
 */
export function createTestRouter(): Router {
  return createRouter({ history: createMemoryHistory(), routes })
}
