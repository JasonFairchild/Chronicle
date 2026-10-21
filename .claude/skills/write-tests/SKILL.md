---
name: write-tests
description: Writing, changing, or reviewing any test in Chronicle — unit, Vitest Browser Mode, Cypress component, or contract suite.
---

# Writing tests in Chronicle

TESTING.md is the authority; this is the order of work. Read TESTING.md's headings, then the sections your change touches.

1. **Pick the layer.** Checking what was stored, or reaching another screen, makes it a flow spec; otherwise it goes in the spec of the file whose code it proves, in the runner for that file's kind (TESTING.md, "Where tests live"). Check what already covers the behavior at the other layers before adding overlap.
2. **See every new test fail before it passes.** Write it before the fix or feature; for code that already exists, break the code under test, run, and restore. It must fail on its assertion, for the reason the test names — not on setup, a wrong query, or a timeout.
3. **Write both runners.** A `.browser.test.ts` gets a `.cy.ts` mirror with the same cases, unless TESTING.md names a real obstacle. Read [mechanics.md](mechanics.md) first: where the runners differ, and setup that has bitten before.
4. **Check every absence waits on a baseline** (TESTING.md, Don'ts).
5. **Run the specs you touched,** as CLAUDE.md "Verify in tiers" says.
6. **Flag, don't write, new guidance.** If a test turns up something TESTING.md should say, name it in your reply for the user to consider; don't edit TESTING.md unasked.
