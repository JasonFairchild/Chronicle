import { createPinia } from 'pinia'
import { render } from 'vitest-browser-vue'

/**
 * The one way Vitest Browser Mode specs mount a component — always a fresh Pinia, since every
 * store-backed spec needs one and it's an inert no-op for the ones that don't. Mirrors what
 * `cy.mount` does for Cypress (`cypress/support/component.ts`); use this instead of importing
 * `render` directly.
 *
 * No router equivalent to `cy.mount`'s `routePath` here: Cypress needs that option to thread a
 * router-ready promise through its command queue before mounting, but a Vitest spec can just
 * `await router.isReady()` inline before calling this, so there's nothing to wrap.
 */
export function renderComponent(
  component: Parameters<typeof render>[0],
  options: Parameters<typeof render>[1] = {},
): ReturnType<typeof render> {
  return render(component, {
    ...options,
    global: {
      ...options.global,
      plugins: [createPinia(), ...(options.global?.plugins ?? [])],
    },
  })
}
