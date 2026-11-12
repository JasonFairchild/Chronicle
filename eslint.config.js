import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
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
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-use-before-define': 'error',
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
        { name: '@/repositories', message: 'Reach storage through a store or useMedia.' },
      ],
    },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
)
