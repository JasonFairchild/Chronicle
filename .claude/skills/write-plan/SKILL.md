---
name: write-plan
description: Planning a Chronicle change that spans more than a step or two — writing or revising a plan file, in plan mode or not. Starts by clearing out finished plans and stale memories.
---

# Writing a plan

1. **Tidy first.** Plans in `~/.claude/plans/` marked `Status: done` more than seven days ago, unless they've come up since: move anything lasting into the docs, then delete them. In memory, drop progress notes, facts that no longer hold, and anything a CLAUDE.md or checked-in doc already says. List what you'd delete, and delete on the user's word.
2. **Read** the sections of the docs in CLAUDE.md's table that cover the change, and the code it touches.
3. **Test the design while it's open.** Skip this for a routine plan.
   - **A decision with real alternatives:** give a fresh Plan agent the draft and the docs, not this session's reasoning, and ask for the weakest decision and a simpler alternative. It argues; you decide, and tell the user what it raised.
   - **Doubt about feasibility:** a spike by an agent in its own worktree, reported back and thrown away, so the user's working tree is untouched.
   - **Several areas not yet read:** parallel Explore agents, so the plan's context holds conclusions rather than file dumps.
4. **Write it in this shape:**
   - The title, then `Status:` — what's committed, updated as commits land, and `done YYYY-MM-DD` at the end.
   - **Context:** why the change, in a few lines.
   - **Decisions**, each with its why, plus any rejected alternative someone would otherwise reopen.
   - **Commits**, in order, each green on its own: what goes in, and its Verify — the tier from CLAUDE.md's verify rule, with the specs it runs named.
   - **Manual check** at the end: what to do in the running app, and what should be seen.
   - Throughout, cite code by name, never `file:line`: the next move of that code makes a line number stale.
5. **Decisions that outlast the plan** go into the docs in the commits that make them, so the plan can be deleted without losing anything.
