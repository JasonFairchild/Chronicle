// ***********************************************************
// This support/component.ts is processed and loaded automatically before your test files.
//
// You can read more here: https://on.cypress.io/configuration
// ***********************************************************

import { type CyMountOptions, mount } from 'cypress/vue'
import { createPinia } from 'pinia'
import '@testing-library/cypress/add-commands'
import '@/assets/main.css'
import { disposeTestRepositories } from '@/testing/realRepositories'
import { createTestRouter } from '@/testing/testRouter'

type MountOptions = CyMountOptions<unknown> & {
  /** When given, mounts behind a real router (real routes, in-memory history) already at this path. */
  routePath?: string
}

/**
 * The one way component specs mount something: always a fresh Pinia (every store-backed spec
 * needs it; it's an inert no-op for the ones that don't), and — only when `routePath` is given — a
 * real router on the app's real route table. Repositories are a separate, opt-in concern: call
 * `freshEntryRepository()` / `freshDraftRepository()` / `freshMediaRepository()` from
 * `@/testing/realRepositories` in a spec's own `beforeEach` for whichever it needs.
 */
function mountWithRealStack(
  // `cypress/vue`'s `mount` is a large overload set keyed on the component's exact shape, with no
  // exported type covering every shape it accepts, so a wrapper forwarding an arbitrary caller
  // component has nothing narrower than `any` to declare it as.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any,
  options: MountOptions = {},
): Cypress.Chainable {
  const { routePath, global, ...rest } = options
  const plugins = [createPinia(), ...(global?.plugins ?? [])]

  if (routePath === undefined) {
    return mount(component, { ...rest, global: { ...global, plugins } })
  }

  const router = createTestRouter()
  return cy
    .wrap(router.push(routePath).then(() => router.isReady()))
    .then(() => mount(component, { ...rest, global: { ...global, plugins: [...plugins, router] } }))
}

Cypress.Commands.add('mount', mountWithRealStack)

// Real storage needs real cleanup. Global rather than per-file so a spec that never creates one
// pays nothing — see `src/testing/realRepositories.ts`.
afterEach(async () => {
  await disposeTestRepositories()
})

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mount: typeof mountWithRealStack
    }
  }
}
