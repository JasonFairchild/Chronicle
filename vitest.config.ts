/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { mergeConfig, defineConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.{test,spec}.ts'],
            exclude: ['src/**/*.browser.{test,spec}.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'browser',
            setupFiles: ['vitest-browser-vue'],
            include: ['src/**/*.browser.{test,spec}.ts'],
            browser: {
              enabled: true,
              provider: playwright(),
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
)
