import { defineConfig } from 'cypress'
import viteConfig from './vite.config'

export default defineConfig({
  component: {
    devServer: {
      framework: 'vue',
      bundler: 'vite',
      viteConfig: {
        ...viteConfig,
        /*
          Well clear of 5173 and the ports Vite walks up to from it when they're taken. A dev
          server sitting on this one does not collide loudly: every spec fails identically with
          "Failed to fetch dynamically imported module" before any test runs, which reads exactly
          like the dep-cache race below and is nothing of the kind. `strictPort` does not help —
          it never fires, since Cypress is serving the specs rather than this port's listener.
        */
        server: { port: 5199 },
        /*
          Cypress's own dep pre-bundle, kept out of the `node_modules/.vite` the dev server uses.

          Cypress builds a different resolved config from the same `vite.config.ts` — its own port,
          its own plugins — and Vite keys the optimizer cache on that config. Sharing one directory
          meant `npm run dev` and `npm run cy:run` invalidated each other in turn, so the first run
          after the other had used it re-optimized on start and served specs while it did. The
          in-flight import of the support file died as "Failed to fetch dynamically imported
          module", outside any test, failing every spec identically — and a second run, now warm,
          passed. Two caches, no shared state to fight over.
        */
        cacheDir: 'node_modules/.vite-cypress',
      },
    },
    specPattern: 'src/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/component.ts',
    indexHtmlFile: 'cypress/support/component-index.html',
  },
})
