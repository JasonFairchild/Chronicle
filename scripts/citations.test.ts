import { describe, expect, it } from 'vitest'

import { checkCitations, citedText } from './citations.ts'

const repo = (files: Record<string, string>) => new Map(Object.entries(files))

/** A doc with a numbered principle, its numbered rules, and an unnumbered heading. */
const guide = [
  '# Guide',
  '',
  '### <a id="fail-first"></a>4. A test must be proven to fail',
  '',
  '- <a id="never-mock"></a>**4.1 -** Never mock what is in scope. Everything runs for real.',
  '- **4.2 -** State what a test expects. Written in the test,',
  '  from the doc that decides it.',
  '',
  '## <a id="coverage"></a>Coverage',
  '',
  'Finds gaps.',
].join('\n')

describe('checkCitations', () => {
  it.each([
    ['an id in a code comment', 'src/one.ts', '// GUIDE.md#never-mock (§4.1)\nexport {}'],
    ['an id with its number in a skill', '.claude/skills/x/SKILL.md', 'GUIDE.md#never-mock (§4.1)'],
    ['a link in a doc', 'NOTES.md', '[GUIDE.md §4.1](GUIDE.md#never-mock)'],
    [
      'a citation in a template comment',
      'src/Three.vue',
      '<template><!-- GUIDE.md#coverage --><p /></template>',
    ],
    [
      'a citation broken across comment lines',
      'src/four.ts',
      '// as GUIDE.md#never-mock\n// (§4.1) says\nexport {}',
    ],
    ['a comment in a JSONC config', 'tool.jsonc', '// GUIDE.md#fail-first (§4)\n{}'],
    ['a CSS comment', 'src/main.css', '/* GUIDE.md#coverage */\n.a {}'],
    [
      'a comment in a component style',
      'src/Nine.vue',
      '<template><p /></template>\n<style>\n/* GUIDE.md#fail-first (§4) */\n</style>',
    ],
  ])('resolves %s', (_, path, text) => {
    expect(checkCitations(repo({ 'GUIDE.md': guide, [path]: text }))).toEqual({
      citations: 1,
      problems: [],
    })
  })

  it('fails a prose citation of another doc, naming the id to cite where there is one', () => {
    const notes =
      'GUIDE.md\'s §4, §4.1 and §9, GUIDE.md, "Coverage", and [GUIDE.md](GUIDE.md) §4.1.'
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'NOTES.md': notes }))

    expect(report.problems.map((p) => p.detail)).toEqual([
      "GUIDE.md's §4, §4.1 and §9: cite as GUIDE.md#fail-first",
      "GUIDE.md's §4, §4.1 and §9: cite as GUIDE.md#never-mock",
      "GUIDE.md's §4, §4.1 and §9",
      'GUIDE.md](GUIDE.md) §4.1: cite as GUIDE.md#never-mock',
      'GUIDE.md, "Coverage"',
    ])
  })

  it('resolves a bare number in its own doc, and fails one it lacks', () => {
    const own = '# Own\n\n## <a id="promises"></a>2. Promises\n\nSee §2, and §7.'

    expect(checkCitations(repo({ 'OWN.md': own }))).toEqual({
      citations: 2,
      problems: [{ kind: 'dangling', file: 'OWN.md', line: 5, detail: '§7' }],
    })
  })

  it('resolves a bare number by the one other doc its paragraph cites, in a doc with no numbers', () => {
    const notes = '[GUIDE.md §4](GUIDE.md#fail-first) leads, and §4.1 follows.\n\nAlone, §4.2.'
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'NOTES.md': notes }))

    expect(report).toEqual({
      citations: 3,
      problems: [
        {
          kind: 'dangling',
          file: 'NOTES.md',
          line: 3,
          detail: '§4.2, with no one other doc cited in its paragraph',
        },
      ],
    })
  })

  it('reads a link to its own doc by name as a link, not as shorthand', () => {
    const notes = '# Notes\n\n## <a id="later"></a>Later\n\nSee [NOTES.md](NOTES.md#later).'

    expect(checkCitations(repo({ 'NOTES.md': notes }))).toEqual({ citations: 1, problems: [] })
  })

  it('fails a bare number whose paragraph cites two other docs', () => {
    const other = '# Other\n\n## <a id="elsewhere"></a>Elsewhere'
    const notes = '[GUIDE.md §4](GUIDE.md#fail-first), [OTHER.md](OTHER.md#elsewhere), then §4.1.'
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'OTHER.md': other, 'NOTES.md': notes }))

    expect(report.problems.map((p) => p.detail)).toEqual([
      '§4.1, with no one other doc cited in its paragraph',
    ])
  })

  it('fails a bare number on a target with no id, which a renumber could not follow', () => {
    const notes = '[GUIDE.md §4](GUIDE.md#fail-first) leads, and §4.2 follows.'
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'NOTES.md': notes }))

    expect(report.problems).toEqual([
      { kind: 'no id', file: 'NOTES.md', line: 1, detail: '§4.2 lands on a target with no id' },
    ])
  })

  describe('a bare number across a renumber since HEAD', () => {
    const before = [
      '- <a id="never-mock"></a>**4.1 -** Never mock what is in scope.',
      '- <a id="state-it"></a>**4.2 -** State what a test expects.',
    ].join('\n')
    const after = [
      '- <a id="run-real"></a>**4.1 -** Run it for real.',
      '- <a id="never-mock"></a>**4.2 -** Never mock what is in scope.',
      '- <a id="state-it"></a>**4.3 -** State what a test expects.',
    ].join('\n')
    const citing = (n: string) => `[GUIDE.md §4.3](GUIDE.md#state-it) leads, and §${n} follows.`

    it('fails one on a line unchanged since HEAD that names a moved rule by its old number', () => {
      const gitHead = repo({ 'GUIDE.md': before, 'NOTES.md': citing('4.1') })
      const report = checkCitations(repo({ 'GUIDE.md': after, 'NOTES.md': citing('4.1') }), gitHead)

      expect(report.problems).toEqual([
        {
          kind: 'stale number',
          file: 'NOTES.md',
          line: 1,
          detail: '§4.1 was never-mock at HEAD, now §4.2',
        },
      ])
    })

    it('trusts one on a changed line, whose number was rewritten with the renumber', () => {
      const gitHead = repo({ 'GUIDE.md': before, 'NOTES.md': citing('4.1') })
      const report = checkCitations(repo({ 'GUIDE.md': after, 'NOTES.md': citing('4.2') }), gitHead)

      expect(report.problems).toEqual([])
    })

    it('fails one on a line unchanged since HEAD whose rule is gone, its number taken by another', () => {
      const removed = '- <a id="state-it"></a>**4.1 -** State what a test expects.'
      const notes = '[GUIDE.md §4.1](GUIDE.md#state-it) leads, and §4.1 follows.'
      const gitHead = repo({ 'GUIDE.md': before, 'NOTES.md': notes })
      const report = checkCitations(repo({ 'GUIDE.md': removed, 'NOTES.md': notes }), gitHead)

      expect(report.problems.map((p) => p.detail)).toEqual([
        '§4.1 was never-mock at HEAD, now gone',
      ])
    })
  })

  it('fails a citation that leaves off the number its target has', () => {
    const code = '// GUIDE.md#never-mock, and GUIDE.md#coverage\nexport {}'
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'src/eleven.ts': code }))

    expect(report.problems).toEqual([
      {
        kind: 'missing number',
        file: 'src/eleven.ts',
        line: 1,
        detail: 'GUIDE.md#never-mock lands on §4.1',
      },
    ])
  })

  it('resolves a doc moved into docs/ by its bare name', () => {
    const notes = 'As [GUIDE.md §4.1](GUIDE.md#never-mock) says.'

    expect(checkCitations(repo({ 'docs/GUIDE.md': guide, 'docs/NOTES.md': notes }))).toEqual({
      citations: 1,
      problems: [],
    })
  })

  it('reads code only in its comments', () => {
    const code = "const label = 'GUIDE.md#nowhere' // GUIDE.md#fail-first (§4)\nexport { label }"

    expect(checkCitations(repo({ 'GUIDE.md': guide, 'src/eight.ts': code }))).toEqual({
      citations: 1,
      problems: [],
    })
  })

  it('ignores a citation in a code span, which is an example of one', () => {
    const notes = 'Cite as `GUIDE.md#nowhere`, never `GUIDE.md §9`.'

    expect(checkCitations(repo({ 'GUIDE.md': guide, 'NOTES.md': notes }))).toEqual({
      citations: 0,
      problems: [],
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

  it('fails a plain citation whose shown number is not where its id lands', () => {
    const code = '// GUIDE.md#never-mock (§4.2)\nexport {}'
    const report = checkCitations(repo({ 'GUIDE.md': guide, 'src/twelve.ts': code }))

    expect(report.problems).toEqual([
      {
        kind: 'stale number',
        file: 'src/twelve.ts',
        line: 1,
        detail: 'GUIDE.md#never-mock (§4.2) shows §4.2, lands on §4.1',
      },
    ])
  })

  it('fails a code file citing one target twice, but not a doc', () => {
    const twice = 'GUIDE.md#fail-first (§4), and later GUIDE.md#fail-first (§4)'
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
          detail: 'GUIDE.md#fail-first (§4), also on line 1',
        },
      ],
    })
  })

  it('lets each /** */ note cite a rule again, since each is read alone on hover', () => {
    const code = [
      '/** Seals once (GUIDE.md#fail-first (§4)). */',
      'export function seal() {}',
      '/** Saves once (GUIDE.md#fail-first (§4)). */',
      'export function save() {}',
    ].join('\n')

    expect(checkCitations(repo({ 'GUIDE.md': guide, 'src/ten.ts': code }))).toEqual({
      citations: 2,
      problems: [],
    })
  })

  it('fails an id used twice in one doc', () => {
    const doubled = '# Doubled\n\n## <a id="same"></a>One\n\n- <a id="same"></a>**Two.**'

    expect(checkCitations(repo({ 'DOUBLED.md': doubled })).problems).toEqual([
      { kind: 'duplicate id', file: 'DOUBLED.md', line: 5, detail: 'same, also on line 3' },
    ])
  })

  it("checks only a plan's ids and links, since its prose quotes old wording", () => {
    const plan =
      '# A plan\n\nStatus: next, step 2.\n\nGUIDE.md, "Old wording", §9 and GUIDE.md#gone.'

    expect(checkCitations(repo({ 'GUIDE.md': guide, 'PLAN.md': plan }))).toEqual({
      citations: 1,
      problems: [{ kind: 'dangling', file: 'PLAN.md', line: 5, detail: 'GUIDE.md#gone' }],
    })
  })
})

describe('citedText', () => {
  const skill = '# Mechanics\n\n- <a id="mount-once"></a>**Mount once.** Per test.'
  const files = repo({ 'GUIDE.md': guide, '.claude/skills/write-x/mechanics.md': skill })

  it.each([
    ['a link to an id', '[GUIDE.md §4](GUIDE.md#fail-first)', 'GUIDE.md', 3],
    ['an id', 'GUIDE.md#never-mock', 'GUIDE.md', 5],
    ['an id with its number', 'GUIDE.md#never-mock (§4.1)', 'GUIDE.md', 5],
    ['a section number', 'GUIDE.md §4', 'GUIDE.md', 3],
    ['a numbered rule without an id', 'GUIDE.md §4.2', 'GUIDE.md', 6],
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
        '- <a id="never-mock"></a>**4.1 -** Never mock what is in scope. Everything runs for real.',
        '- **4.2 -** State what a test expects. Written in the test,',
        '  from the doc that decides it.',
      ].join('\n'),
    )
  })

  it('prints a rule with its continuation lines', () => {
    expect(citedText(files, 'GUIDE.md §4.2')?.text).toBe(
      '- **4.2 -** State what a test expects. Written in the test,\n  from the doc that decides it.',
    )
  })

  it('finds a doc moved into docs/ by its bare name', () => {
    expect(citedText(repo({ 'docs/GUIDE.md': guide }), 'GUIDE.md#coverage')).toEqual({
      doc: 'docs/GUIDE.md',
      line: 9,
      text: '## <a id="coverage"></a>Coverage\n\nFinds gaps.',
    })
  })

  it('returns nothing for a citation that lands nowhere', () => {
    expect(citedText(files, 'GUIDE.md#renamed-away')).toBeUndefined()
  })
})
