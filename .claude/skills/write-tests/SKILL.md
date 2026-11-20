---
name: write-tests
description: Writing, changing, or reviewing any test in Chronicle — unit, Vitest Browser Mode, Cypress component, or contract suite.
---

# Writing tests in Chronicle

TESTING.md is the authority; this is the order of work. Read TESTING.md's headings, then the sections your change touches.

1. **Look before adding or deleting a test.** Before adding one, look for a test that already reaches that state and extend it instead (TESTING.md §2), and for what already covers the behavior at the other layers. Before deleting one because another now covers it, check coverage for lines only it reached: a test can exercise a path it never asserts.
2. **Pick the layer** for anything new, and write it there (TESTING.md §3 and "Layers").
3. **See every new test fail before it passes.** Write it before the fix or feature. The failure counts only on its assertion — not on setup, a wrong query, a timeout, or a crash on the way there — and a test with more than one claim sees each one fail.
4. **Write both runners** (TESTING.md §3). Read [mechanics.md](mechanics.md) first: where the runners differ, and setup that has bitten before. Pass the component under test to `cy.mount` / `renderComponent` itself, not wrapped in `defineComponent`, so the spec proves the real component and not one made up in setup; a host whose only job is to call a composable is the exception.
5. **Check every absence waits on a baseline** (TESTING.md §4).
6. **Run the specs you touched.** Leave an existing `.only` in place unless asked.
7. **Name the home of any guidance you flag:** a rule goes in TESTING.md, a runner difference or setup that bites goes in mechanics.md, a step in the work goes here.
