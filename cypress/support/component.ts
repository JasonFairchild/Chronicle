// Loaded automatically before every component spec: https://on.cypress.io/configuration

import '@testing-library/cypress/add-commands'
import 'cypress-real-events'
import '@/assets/main.css'

import { type CyMountOptions, mount } from 'cypress/vue'
import type { Router } from 'vue-router'

import { createTestRouter } from '@/testing/testRouter'
import { beginTest, createTrackedPinia, endTest } from '@/testing/testStorage'

type MountOptions = CyMountOptions<unknown> & {
  /** When given, mounts behind a real router (real routes, in-memory history) already at this path. */
  routePath?: string
  /** With `routePath`, the router to use, for a spec that reads where the component navigated. */
  router?: Router
}

/**
 * The one way component specs mount something: always a fresh Pinia (every store-backed spec
 * needs it; it's an inert no-op for the ones that don't), and — only when `routePath` is given — a
 * real router on the app's real route table, the spec's own if it passes one. Storage is set up by
 * the hooks below, not here.
 */
function mountWithRealStack(
  // `cypress/vue`'s `mount` is a large overload set keyed on the component's exact shape, with no
  // exported type covering every shape it accepts, so a wrapper forwarding an arbitrary caller
  // component has nothing narrower than `any` to declare it as.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any,
  options: MountOptions = {},
): Cypress.Chainable {
  const { routePath, router = createTestRouter(), global, ...rest } = options
  const plugins = [createTrackedPinia(), ...(global?.plugins ?? [])]

  if (routePath === undefined) {
    return mount(component, { ...rest, global: { ...global, plugins } })
  }

  return cy
    .wrap(router.push(routePath).then(() => router.isReady()))
    .then(() => mount(component, { ...rest, global: { ...global, plugins: [...plugins, router] } }))
}

Cypress.Commands.add('mount', mountWithRealStack)

function isLastTest(test: Mocha.Runnable | undefined): boolean {
  // The runner's own Mocha, missing from Cypress's types.
  const { mocha } = Cypress as unknown as { mocha: { getRootSuite(): Mocha.Suite } }
  let last: Mocha.Test | undefined
  mocha.getRootSuite().eachTest((each) => {
    last = each
  })
  return test === last
}

beforeEach(beginTest)

afterEach(async function () {
  // In open mode Cypress leaves the last test's component up to use, and so does this, by skipping
  // teardown. A rerun reloads the spec, and `beginTest` empties storage before its first test.
  if (Cypress.config('isInteractive') && isLastTest(this.currentTest)) return

  // `cy.mount` unmounts only after every `afterEach`, past the clear, so unmount here and let
  // `endTest` drain a view's writes on unmount. Its own unmount, later, is then harmless.
  Cypress.vueWrapper?.unmount()
  await endTest()
})

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mount: typeof mountWithRealStack
    }
  }
}
