---
name: write-plan
description: Planning a Chronicle change that spans more than a step or two — writing or revising a plan file, in plan mode or not.
---

# Writing a plan

1. **Tidy first.** Plans in `~/.claude/plans/` marked `Status: done` more than seven days ago, unless they've come up since: move anything lasting into the docs, then delete them. In memory, drop progress notes, facts that no longer hold, and anything a CLAUDE.md or checked-in doc already says. List what you'd delete, and delete on the user's word.
2. **Read** the sections of the docs in CLAUDE.md's table that cover the change, and the code it touches.
3. **Test the design while it's open.** Skip this for a routine plan.
   - **A decision with real alternatives:** give a fresh Plan agent the draft and the docs, not this session's reasoning, and ask for the weakest decision, a simpler alternative, and what the change makes redundant: guards, bookkeeping, parameters, and their tests. It argues; you decide, and tell the user all it raised, rejections included; in the plan, a rejection is its judgement, not a decision.
   - **Doubt about feasibility:** a spike by an agent in its own worktree, reported back and thrown away, so the user's working tree is untouched.
   - **Several areas not yet read:** parallel Explore agents, so the plan's context holds conclusions rather than file dumps.
4. **Write it in this shape:**
   - The title, then `Status:` — the next step and any manual check or hands-on pass still to run; `git log` says what's committed. `done YYYY-MM-DD` at the end.
   - **Context:** why the change, in a few lines.
   - **What the writer sees change:** before and after in PRODUCT.md's terms, or "nothing". A behaviour removed, an interim rule, and what deleted code was meant for are listed here, never under Decisions. A change to how writing feels (caret, spacing, focus) names a hands-on pass before review.
   - **Decisions** that cover the whole plan, each with its why, then any rejected alternative someone would otherwise reopen. A decision that shapes one step sits in that step, led by **Decision:**.
   - **Steps**, in order, each green on its own and reviewed unstaged: what goes in, and its Verify — typecheck and the specs covering it, named, plus a manual check, where only the running app can show it: what to do and what to see.
   - A plan is a doc, so the write-docs skill holds throughout, as it does for any step that changes a doc.
5. **Decisions that outlast the plan** go into the docs in the steps that make them, so the plan can be deleted without losing anything.
