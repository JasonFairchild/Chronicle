import { afterEach } from 'vitest'
import { cleanup } from 'vitest-browser-vue'
import { disposeTestRepositories } from './realRepositories'

/**
 * Registered as a `browser` project `setupFiles` entry in vitest.config.ts — Vitest's real
 * equivalent of `cypress/support/component.ts`. Global by design: specs that never call any
 * `freshXRepository()` just get a no-op `afterEach`.
 *
 * `vitest-browser-vue` only unmounts a test's component in the *next* test's `beforeEach`, not
 * this test's `afterEach` — so without an explicit `cleanup()` first, a still-mounted component's
 * watchers could fire against a database this hook is about to delete. Unmount, then dispose.
 */
afterEach(async () => {
  cleanup()
  await disposeTestRepositories()
})
