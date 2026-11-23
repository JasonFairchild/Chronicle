import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import helperOrder from './helperOrder.ts'

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } })

const lines = (...code: string[]) => code.join('\n')

tester.run('helper-order', helperOrder, {
  valid: [
    {
      name: 'helpers above their user, in the order it uses them',
      code: lines('function a() {}', 'const b = () => {}', 'function run() { a(); b(); a() }'),
    },
    {
      name: "a helper's own helpers above it",
      code: lines(
        'function aa() {}',
        'function a() { aa() }',
        'function b() {}',
        'function run() { a(); b() }',
      ),
    },
    {
      name: 'a shared helper above its first user',
      code: lines(
        'function shared() {}',
        'function first() { shared() }',
        'function second() { shared() }',
      ),
    },
    {
      name: 'a statement that declares no function between a helper and its user',
      code: lines('function a() {}', 'const limit = 3', 'function run() { a(limit) }'),
    },
    {
      name: 'a helper calling itself',
      code: lines(
        'function walk(n: number): number { return n && walk(n - 1) }',
        'function run() { walk(3) }',
      ),
    },
    {
      name: 'an exported function, placed apart from its first user',
      code: lines(
        'export function shared() {}',
        'function other() {}',
        'function run() { shared() }',
      ),
    },
    {
      name: 'actions a scope returns, placed apart from their first user',
      code: lines(
        'function useThing() {',
        '  function load() {}',
        '  function save() {}',
        '  function reset() { load() }',
        '  return reactive({ save, load, reset })',
        '}',
      ),
    },
    {
      name: 'a let holding a function, as a slot assigned later',
      code: lines('function a() {}', 'let settle = () => {}', 'function run() { settle = a; a() }'),
    },
    {
      name: 'a function between a helper and the statement that uses it',
      code: lines('function a() {}', 'function b() {}', 'const x = a()', 'const y = b()'),
    },
    {
      name: 'a module helper first used inside a store setup',
      code: lines(
        'function a() {}',
        'function b() {}',
        "export const useThing = defineStore('thing', () => {",
        '  function save() { a() }',
        '  function load() { b() }',
        '  return { save, load }',
        '})',
      ),
    },
    {
      name: 'a component script setup',
      filename: 'Thing.vue',
      languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser } },
      code: lines(
        '<script setup lang="ts">',
        'function a() {}',
        'function onSave() { a() }',
        '</script>',
        '<template><button @click="onSave" /></template>',
      ),
    },
  ],
  invalid: [
    {
      name: 'siblings in the wrong order',
      code: lines('function b() {}', 'function a() {}', 'function run() { a(); b() }'),
      errors: [{ message: '`a` goes just above `b`, since `run` uses it first.', line: 2 }],
    },
    {
      name: 'one helper out of place among several, reported alone',
      code: lines(
        'function d() {}',
        'function a() {}',
        'function b() {}',
        'function c() {}',
        'function run() { a(); b(); c(); d() }',
      ),
      errors: [{ message: '`d` goes just below `c`, since `run` uses it last.', line: 1 }],
    },
    {
      name: 'a helper passed as a callback before another is called',
      code: lines(
        'function a() {}',
        'function b() {}',
        'function run(xs: number[]) { xs.map(b); a() }',
      ),
      errors: [{ message: '`b` goes just above `a`, since `run` uses it first.', line: 2 }],
    },
    {
      name: 'a helper above a function it does not serve',
      code: lines('function a() {}', 'function other() {}', 'function run() { a() }'),
      errors: [
        {
          message: '`a` is first used by `run`, but `other`, between them, is not its helper.',
          line: 1,
        },
      ],
    },
    {
      name: 'a helper above an exported function it does not serve',
      code: lines(
        'function a() {}',
        'function other() {}',
        'function run() { a() }',
        'export { other }',
      ),
      errors: [
        {
          message: '`a` is first used by `run`, but `other`, between them, is not its helper.',
          line: 1,
        },
      ],
    },
    {
      name: "a helper above another user's helper",
      code: lines(
        'function forSecond() {}',
        'function forFirst() {}',
        'function first() { forFirst() }',
        'function second() { forSecond() }',
      ),
      errors: [
        {
          message:
            '`forSecond` is first used by `second`, but `forFirst`, between them, is not its helper.',
          line: 1,
        },
      ],
    },
    {
      name: 'a helper calling itself, placed by its first other user',
      code: lines(
        'function walk(n: number): number { return n && walk(n - 1) }',
        'function other() {}',
        'function run() { walk(3) }',
      ),
      errors: [
        {
          message: '`walk` is first used by `run`, but `other`, between them, is not its helper.',
          line: 1,
        },
      ],
    },
    {
      name: "a helper returned by another function's object, not its own scope's",
      code: lines(
        'function a() {}',
        'function b() {}',
        'function run() { b() }',
        'function wrap() { return { a } }',
      ),
      errors: [
        {
          message: '`a` is first used by `wrap`, but `b`, between them, is not its helper.',
          line: 1,
        },
      ],
    },
    {
      name: "a statement's helpers out of order",
      code: lines('function b() {}', 'function a() {}', 'void [a(), b()]'),
      errors: [{ message: '`a` goes just above `b`, since line 3 uses it first.', line: 2 }],
    },
    {
      name: 'a helper above a statement it does not serve',
      code: lines(
        'function a() {}',
        'function b() {}',
        'const total = b()',
        'function run() { a() }',
      ),
      errors: [
        {
          message: '`a` is first used by `run`, but `b`, between them, is not its helper.',
          line: 1,
        },
      ],
    },
  ],
})
