import { describe, expect, it } from 'vitest'

import { checkCitations, citedText } from './citations.ts'

const repo = (files: Record<string, string>) => new Map(Object.entries(files))

/** A doc with a numbered principle, its numbered rules, and an unnumbered heading. */
const guide = [
  '# Guide',
  '',
  '### <a id="fail-first"></a>4. A test must be proven to fail',
  '',
  '- <a id="never-mock"></a>**4.1 Never mock what is in scope.** Everything runs for real.',
  '- **4.2 State what a test expects.** Written in the test,',
  '  from the doc that decides it.',
  '',
  '## Coverage',
  '',
  'Finds gaps.',
].join('\n')

describe('checkCitations', () => {
  it.each([
    ['an id in a code comment', 'src/one.ts', '// GUIDE.md#never-mock\nexport {}'],
    ['a numbered rule in a code comment', 'src/two.ts', '// GUIDE.md §4.2\nexport {}'],
    [
      'a citation in a template comment',
      'src/Three.vue',
      '<template><!-- GUIDE.md, "State what a test expects" --><p /></template>',
    ],
    [
      'a name broken across comment lines',
      'src/four.ts',
      '// as GUIDE.md, "State what\n// a test expects" says\nexport {}',
    ],
    ['a comment in a JSONC config', 'tool.jsonc', '// GUIDE.md §4\n{}'],
    ['a CSS comment', 'src/main.css', '/* GUIDE.md, "Coverage" */\n.a {}'],
    [
      'a comment in a component style',
      'src/Nine.vue',
      '<template><p /></template>\n<style>\n/* GUIDE.md §4 */\n</style>',
    ],
  ])('resolves %s', (_, path, text) => {
    expect(checkCitations(repo({ 'GUIDE.md': guide, [path]: text }))).toEqual({
      citations: 1,
      problems: [],
      prefixOnly: [],
    })
  })

  it('resolves each number in a list', () => {
    const report = checkCitations(
      repo({ 'GUIDE.md': guide, 'NOTES.md': "GUIDE.md's §4, §4.1 and §9." }),
    )

    expect(report).toEqual({
      citations: 3,
      problems: [
        { kind: 'dangling', file: 'NOTES.md', line: 1, detail: "GUIDE.md's §4, §4.1 and §9" },
      ],
      prefixOnly: [],
    })
  })

  it('resolves a bare number in its own doc, and fails one it lacks', () => {
    const own = '# Own\n\n## 2. Promises\n\nSee §2, and §7.'

    expect(checkCitations(repo({ 'OWN.md': own }))).toEqual({
      citations: 2,
      problems: [{ kind: 'dangling', file: 'OWN.md', line: 5, detail: '§7' }],
      prefixOnly: [],
    })
  })

  it('resolves a doc moved into docs/ by its bare name', () => {
    expect(
      checkCitations(repo({ 'docs/GUIDE.md': guide, 'docs/NOTES.md': 'As GUIDE.md §4.1 says.' })),
    ).toEqual({ citations: 1, problems: [], prefixOnly: [] })
  })

  it('reads code only in its comments', () => {
    const code = "const label = 'GUIDE.md#nowhere' // GUIDE.md §4\nexport { label }"

    expect(checkCitations(repo({ 'GUIDE.md': guide, 'src/eight.ts': code }))).toEqual({
      citations: 1,
      problems: [],
      prefixOnly: [],
    })
  })

  it('fails a citation that lands nowhere', () => {
    const report = checkCitations(
      repo({ 'GUIDE.md': guide, 'src/six.ts': '// GUIDE.md#renamed-away\nexport {}' }),
    )

    expect(report.problems).toEqual([
      { kind: 'dangling', file: 'src/six.ts', line: 1, detail: 'GUIDE.md#renamed-away' },
    ])
  })

  it('fails a link whose shown number is not where its id lands', () => {
    const report = checkCitations(
      repo({ 'GUIDE.md': guide, 'NOTES.md': '[GUIDE.md §4.2](GUIDE.md#never-mock)' }),
    )

    expect(report.problems).toEqual([
      {
        kind: 'stale number',
        file: 'NOTES.md',
        line: 1,
        detail: '[GUIDE.md §4.2](GUIDE.md#never-mock) shows §4.2, lands on §4.1',
      },
    ])
  })

  it('fails a code file citing one target twice, but not a doc', () => {
    const twice = 'GUIDE.md §4, and later GUIDE.md#fail-first'
    const report = checkCitations(
      repo({ 'GUIDE.md': guide, 'src/seven.ts': `// ${twice}\nexport {}`, 'NOTES.md': twice }),
    )

    expect(report).toEqual({
      citations: 4,
      problems: [
        {
          kind: 'cited twice',
          file: 'src/seven.ts',
          line: 1,
          detail: 'GUIDE.md §4, also on line 1',
        },
      ],
      prefixOnly: [],
    })
  })

  it('lets each /** */ note cite a rule again, since each is read alone on hover', () => {
    const code = [
      '/** Seals once (GUIDE.md §4). */',
      'export function seal() {}',
      '/** Saves once (GUIDE.md §4). */',
      'export function save() {}',
    ].join('\n')

    expect(checkCitations(repo({ 'GUIDE.md': guide, 'src/ten.ts': code }))).toEqual({
      citations: 2,
      problems: [],
      prefixOnly: [],
    })
  })

  it('fails an id used twice in one doc', () => {
    const doubled = '# Doubled\n\n## <a id="same"></a>One\n\n- <a id="same"></a>**Two.**'

    expect(checkCitations(repo({ 'DOUBLED.md': doubled })).problems).toEqual([
      { kind: 'duplicate id', file: 'DOUBLED.md', line: 5, detail: 'same, also on line 3' },
    ])
  })

  it('lists a citation matching only the start of a title, without failing it', () => {
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'NOTES.md': 'GUIDE.md, "Never mock"' }))

    expect(report).toEqual({
      citations: 1,
      problems: [],
      prefixOnly: [
        {
          kind: 'prefix only',
          file: 'NOTES.md',
          line: 1,
          detail: 'GUIDE.md, "Never mock" ~ "Never mock what is in scope."',
        },
      ],
    })
  })

  it('skips a plan, which quotes old wording on purpose', () => {
    const plan = '# A plan\n\nStatus: next, step 2.\n\nGUIDE.md, "Old wording" and GUIDE.md#gone.'
    const report = checkCitations(
      repo({ 'GUIDE.md': guide, 'PLAN.md': plan, 'NOTES.md': 'GUIDE.md §4' }),
    )

    expect(report).toEqual({ citations: 1, problems: [], prefixOnly: [] })
  })
})

describe('citedText', () => {
  const skill = '# Mechanics\n\n- <a id="mount-once"></a>**Mount once.** Per test.'
  const files = repo({ 'GUIDE.md': guide, '.claude/skills/write-x/mechanics.md': skill })

  it.each([
    ['a link to an id', '[GUIDE.md §4](GUIDE.md#fail-first)', 'GUIDE.md', 3],
    ['an id', 'GUIDE.md#never-mock', 'GUIDE.md', 5],
    ['a section number', 'GUIDE.md §4', 'GUIDE.md', 3],
    ['a numbered rule', 'GUIDE.md §4.2', 'GUIDE.md', 6],
    ['a link followed by a number', '[GUIDE.md](GUIDE.md) §4.1', 'GUIDE.md', 5],
    ['a heading by name', 'GUIDE.md, "Coverage"', 'GUIDE.md', 9],
    ['a bold lead by name, possessive', 'GUIDE.md\'s "State what a test expects"', 'GUIDE.md', 6],
    [
      'a skill file by its repo path',
      '.claude/skills/write-x/mechanics.md#mount-once',
      '.claude/skills/write-x/mechanics.md',
      3,
    ],
  ])('lands %s on its line', (_, citation, doc, line) => {
    expect(citedText(files, citation)).toMatchObject({ doc, line })
  })

  it('prints a heading through to the next heading of its level or above', () => {
    expect(citedText(files, 'GUIDE.md#fail-first')?.text).toBe(
      [
        '### <a id="fail-first"></a>4. A test must be proven to fail',
        '',
        '- <a id="never-mock"></a>**4.1 Never mock what is in scope.** Everything runs for real.',
        '- **4.2 State what a test expects.** Written in the test,',
        '  from the doc that decides it.',
      ].join('\n'),
    )
  })

  it('prints a rule with its continuation lines', () => {
    expect(citedText(files, 'GUIDE.md §4.2')?.text).toBe(
      '- **4.2 State what a test expects.** Written in the test,\n  from the doc that decides it.',
    )
  })

  it('finds a doc moved into docs/ by its bare name', () => {
    expect(citedText(repo({ 'docs/GUIDE.md': guide }), 'GUIDE.md, "Coverage"')).toEqual({
      doc: 'docs/GUIDE.md',
      line: 9,
      text: '## Coverage\n\nFinds gaps.',
    })
  })

  it('returns nothing for a citation that lands nowhere', () => {
    expect(citedText(files, 'GUIDE.md#renamed-away')).toBeUndefined()
  })
})
