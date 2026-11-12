// Registered as a `browser` project `setupFiles` entry in vitest.config.ts — Vitest's real
// equivalent of `cypress/support/component.ts`.

import { afterEach, beforeEach } from 'vitest'
import { cleanup } from 'vitest-browser-vue'

import { beginTest, endTest } from '@/testing/testStorage'

beforeEach(beginTest)

afterEach(async () => {
  // `vitest-browser-vue` unmounts only in the next test's `beforeEach`; unmounting starts writes of
  // its own (a view abandons its draft session), which `endTest` drains.
  cleanup()
  await endTest()
})
