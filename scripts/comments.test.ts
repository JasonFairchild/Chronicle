import { describe, expect, it } from 'vitest'

import { fileComments } from './comments.ts'

describe('fileComments', () => {
  it('finds a comment beside code, but not one inside a string', () => {
    expect(fileComments('a.ts', "const a = '// not one'\n// one")).toEqual([
      { start: 2, end: 2, text: '// one', ownLine: true },
    ])
  })

  it('joins a run of // lines, but not onto a comment trailing code', () => {
    const code = 'const a = 1 // trailing\n// first\n// second\nexport { a }'

    expect(fileComments('a.ts', code)).toEqual([
      { start: 1, end: 1, text: '// trailing', ownLine: false },
      { start: 2, end: 3, text: '// first\n// second', ownLine: true },
    ])
  })

  it('reads a block comment over all its lines', () => {
    expect(fileComments('a.js', '/**\n * Note.\n */\nexport {}')).toEqual([
      { start: 1, end: 3, text: '/**\n * Note.\n */', ownLine: false },
    ])
  })

  it('reads a comment in a JSONC config', () => {
    expect(fileComments('a.jsonc', '{\n  // note\n  "a": 1\n}')).toEqual([
      { start: 2, end: 2, text: '// note', ownLine: true },
    ])
  })

  it('reads a CSS file', () => {
    expect(fileComments('a.css', '.a {}\n/* one\n   two */')).toEqual([
      { start: 2, end: 3, text: '/* one\n   two */', ownLine: false },
    ])
  })

  it("reads a component's template, script and style, each on its file line", () => {
    const component = [
      '<template>',
      '  <!-- in template -->',
      '  <p>// not one</p>',
      '</template>',
      '<script setup lang="ts">',
      '// in script',
      '</script>',
      '<style scoped>',
      '/* in style */',
      '</style>',
    ].join('\n')

    expect(fileComments('A.vue', component)).toEqual([
      { start: 2, end: 2, text: '<!-- in template -->', ownLine: false },
      { start: 6, end: 6, text: '// in script', ownLine: true },
      { start: 9, end: 9, text: '/* in style */', ownLine: false },
    ])
  })

  it("returns nothing for a kind of file it doesn't read", () => {
    expect(fileComments('notes.md', '<!-- a -->')).toBeUndefined()
  })
})
