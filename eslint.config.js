import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

import helperOrder from './scripts/lint/helperOrder.ts'

/** A relative path to a test helper loads a second copy, whose Pinia no setup file's teardown drains. */
const testingByAlias = {
  regex: '^\\.{1,2}/(.*/)?testing(/|$)',
  message: 'Import test helpers as @/testing/….',
}

export default defineConfig(
  { ignores: ['dist', 'dev-dist', 'coverage', 'cypress/downloads', '.staged', 'spikes'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  eslintConfigPrettier,
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      local: { rules: { 'helper-order': helperOrder } },
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-use-before-define': 'error',
      'local/helper-order': 'error',
    },
  },
  {
    // Only a declaration file needs a reference; elsewhere tsconfig's `types` or an import does it.
    files: ['**/*.{ts,vue}'],
    ignores: ['**/*.d.ts'],
    rules: { '@typescript-eslint/triple-slash-reference': ['error', { types: 'never' }] },
  },
  {
    // A block naming this rule replaces an earlier one's options for its files, so each repeats it.
    files: ['**/*.{ts,vue}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [testingByAlias] }] },
  },
  {
    files: ['src/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [testingByAlias, { regex: '^\\./', message: testingByAlias.message }] },
      ],
    },
  },
  {
    // Parse <script setup lang="ts"> in SFCs as TypeScript
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    // Only the writers `src/testing/testStorage.ts` drains may reach the composition root; any
    // other could write into the next test unseen.
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/{stores,testing}/**', 'src/composables/useMedia.ts', 'src/**/*.{test,cy}.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@/repositories', message: 'Reach storage through a store or useMedia.' },
          ],
          patterns: [testingByAlias],
        },
      ],
    },
  },
  {
    // A component spec proves the component it mounts, not one made up in setup.
    files: ['src/**/*.{browser.test,cy}.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='defineComponent']",
          message:
            'Mount the component under test itself. A host whose only job is to call a composable is the exception.',
        },
      ],
    },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
)
