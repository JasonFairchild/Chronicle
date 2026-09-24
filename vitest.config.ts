/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { mergeConfig, defineConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      coverage: {
        // Istanbul, not v8: v8 coverage needs Node's inspector, which Browser Mode's Playwright
        // tab doesn't expose, so it can't cover the `browser` project at all. Istanbul instruments
        // the source itself, so it works for both projects — and it's also what `@cypress/code-coverage`
        // consumes, so Cypress coverage stays a cheap add later rather than a second provider.
        provider: 'istanbul',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,vue}'],
        exclude: [
          'src/**/*.{test,spec}.ts',
          'src/**/*.cy.ts',
          'src/**/*.contract.ts',
          'src/testing/**',
          'src/main.ts',
        ],
      },
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
            setupFiles: ['vitest-browser-vue', './src/testing/browserSetup.ts'],
            include: ['src/**/*.browser.{test,spec}.ts'],
            browser: {
              enabled: true,
              // Vitest only headless-izes this by default in CI; without it, every local run pops
              // a real Chromium window.
              headless: true,
              provider: playwright(),
              instances: [{ browser: 'chromium' }],
            },
          },
          // Pre-bundled up front. Discovering these mid-run makes Vite reload the page,
          // which Vitest warns can duplicate or flake a test.
          optimizeDeps: {
            include: ['vue-router', 'pinia', '@tiptap/extensions', '@tiptap/pm/transform'],
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
