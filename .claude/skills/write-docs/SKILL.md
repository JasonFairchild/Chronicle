---
name: write-docs
description: Editing any checked-in doc, plan or skill in Chronicle — TESTING.md, PRODUCT.md, a plan file, a SKILL.md — or adding a line to one.
---

# Writing docs in Chronicle

CLAUDE.md's table says which doc is the authority on what. These hold in every doc and skill.

1. **One home per rule, cited everywhere else.** State a rule once, with its reason, in the doc that's the authority on it. Elsewhere cite it by the id of what you mean, with its number where it has one: `[GUIDE.md §4.3](GUIDE.md#rule-id)` in a doc, `GUIDE.md#rule-id (§4.3)` in a skill or code, which don't render links. A short citation, `§N` alone, cites its own doc where that doc has numbers, and fails where its paragraph cites another doc that has that number too, so cite the one meant by id; in a doc without, it cites the one other doc its paragraph cites. A step that applies a rule may name the action in a few words beside its citation, never the reason, which is what drifts when a rule is copied. Whatever is newly cited gets an id first on its line, `- <a id="rule-id"></a>**4.3 -** Its rule.`, named for what it says, without its number, so a renumber leaves it alone; a reworded rule keeps its id, and one whose meaning changes gets a new one. `npm run citations` holds every citation to where it lands, and fails a prose one of another doc.
2. **Examples are generic**, unless they point at code the reader would go and open. A real-looking name that isn't goes stale without anyone noticing.
3. **Cite code by name, never `file:line`:** the next move of that code makes a line number stale.
4. **Gaps and to-dos go in a plan** (CHRONICLE_PLAN.md or the plan for that work), not in a doc of rules.
5. **Verify** with `npm run format:check`. After changing ARCHITECTURE.md's diagram, render it with `npm run diagram` and look at the layout.
