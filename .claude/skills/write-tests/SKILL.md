---
name: write-tests
description: Writing, changing, or reviewing any test in Chronicle — unit, Vitest Browser Mode, Cypress component, or contract suite.
---

# Writing tests in Chronicle

TESTING.md is the authority; this is the order of work. Read TESTING.md's headings, then the sections your change touches.

1. **Look before adding or deleting a test.** Before adding one, extend a test that already reaches that state (TESTING.md#group-by-state (§2.4)), and look for what already covers the behavior at the other layers. Before deleting one because another now covers it, check coverage for lines only it reached: a test can exercise a path it never asserts.
2. **Pick the layer** for anything new, and write it there (TESTING.md#proven-once (§3) and TESTING.md#layers).
3. **Write each new test before its fix or feature, and see it fail** (TESTING.md#see-it-fail (§4.1)).
4. **Write both runners.** Read [mechanics.md](mechanics.md) first: where the runners differ, and setup that has bitten before.
5. **Check every absence waits on a baseline** (TESTING.md#absence-baseline (§4.3)).
6. **Run the specs you touched.** Leave an existing `.only` in place unless asked.
7. **Name the home of any guidance you flag** (CLAUDE.md#rework-to-rule): a rule goes in TESTING.md, a runner difference or setup that bites goes in mechanics.md, a step in the work goes here.
