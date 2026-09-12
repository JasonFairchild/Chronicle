import { defineConfig } from 'cypress'
import viteConfig from './vite.config'

export default defineConfig({
  component: {
    devServer: {
      framework: 'vue',
      bundler: 'vite',
      viteConfig: {
        ...viteConfig,
        server: {
          ...(typeof viteConfig === 'object' && viteConfig && 'server' in viteConfig
            ? (viteConfig as { server?: object }).server
            : {}),
          port: 5174,
        },
      },
    },
    specPattern: 'src/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/component.ts',
    indexHtmlFile: 'cypress/support/component-index.html',
  },
})
