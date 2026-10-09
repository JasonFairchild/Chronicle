import { afterEach, beforeEach } from 'vitest'
import { cleanup } from 'vitest-browser-vue'
// By alias, as specs import it: a relative path loads a second copy, with its own database.
import { disposeTestRepositories, freshRepositories } from '@/testing/realRepositories'

/**
 * Registered as a `browser` project `setupFiles` entry in vitest.config.ts — Vitest's real
 * equivalent of `cypress/support/component.ts`. Every test starts on fresh storage, so none can
 * fall through to the app's own database.
 *
 * `vitest-browser-vue` only unmounts a test's component in the *next* test's `beforeEach`, not
 * this test's `afterEach` — so without an explicit `cleanup()` first, a still-mounted component's
 * watchers could fire against a database this hook is about to delete. Unmount, then dispose.
 */
beforeEach(() => {
  freshRepositories()
})

afterEach(async () => {
  cleanup()
  await disposeTestRepositories()
})
