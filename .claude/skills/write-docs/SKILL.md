---
name: write-docs
description: Editing any checked-in doc, plan or skill in Chronicle — TESTING.md, PRODUCT.md, a plan file, a SKILL.md — or adding a line to one.
---

# Writing docs in Chronicle

CLAUDE.md's table says which doc is the authority on what. These hold in every doc and skill.

1. **One home per rule.** State it once, with its reason, in the doc that's the authority on it, and point to it elsewhere. A checklist step that applies a rule may restate it in a few of its home's words, without the reason: the reason is what drifts when a rule is copied, and the shared words let a search find every copy.
2. **Examples are generic**, unless they point at code the reader would go and open. A real-looking name that isn't goes stale without anyone noticing.
3. **Cite code by name, never `file:line`:** the next move of that code makes a line number stale.
4. **Gaps and to-dos go in a plan** (CHRONICLE_PLAN.md or the plan for that work), not in a doc of rules.
5. **Verify** with `npm run format:check`. After changing ARCHITECTURE.md's diagram, render it with `npm run diagram` and look at the layout.
