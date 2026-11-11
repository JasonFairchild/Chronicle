import { writeFileSync } from 'node:fs'

import { defineConfig } from 'cypress'
import cypressOnFix from 'cypress-on-fix'
import cypressSplit from 'cypress-split'

import viteConfig from './vite.config'

export default defineConfig({
  component: {
    devServer: {
      framework: 'vue',
      bundler: 'vite',
      viteConfig: {
        ...viteConfig,
        // Clear of 5173 and the ports Vite walks up to. A dev server already on it fails every
        // spec with "Failed to fetch dynamically imported module", and `strictPort` never fires.
        server: { port: 5199 },
        // Apart from the dev server's `node_modules/.vite`: Cypress adds its own plugins, which
        // Vite hashes, so a shared cache was rebuilt at each switch and every spec served during
        // the rebuild failed. The parallel runner gives each worker its own.
        cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite-cypress',
      },
    },
    setupNodeEvents(cypressOn, config) {
      // Cypress keeps only the last handler per event; cypress-split and the parallel runner both
      // need `after:spec` and `after:run`.
      const on = cypressOnFix(cypressOn)
      cypressSplit(on, config) // Does nothing unless the parallel runner sets SPLIT.

      const resultsFile = process.env.CY_PARALLEL_RESULTS_FILE
      if (resultsFile) {
        // The runner reads this line to time each spec's overhead as it finishes.
        on('after:spec', (_spec, results) => {
          process.stdout.write(`[cy-par] spec-done ${results.stats.duration}\n`)
        })
        on('after:run', (results) => writeFileSync(resultsFile, JSON.stringify(results)))
      }
      return config
    },
    viewportWidth: 800,
    viewportHeight: 800,
    specPattern: 'src/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/component.ts',
    indexHtmlFile: 'cypress/support/component-index.html',
  },
})
