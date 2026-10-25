---
name: cr
description: Getting uncommitted work in Chronicle ready to commit — review it, verify it, and draft its message. Use when the user asks to review uncommitted work, whether it's ready to commit, or for a commit message. Never commits.
---

# Getting a commit ready

Run when the user asks, not after every turn. The review can change the code, so verification follows it and the message is written last, about what survived. Report in order: findings and fixes, verification, then size and message.

1. **Scope.** The commit is everything uncommitted unless the user says otherwise: `git diff HEAD`, plus untracked files. If it reads as more than one commit, propose the split before reviewing.
2. **Review** by answering each question for this diff, with evidence. "Nothing" is an answer; skipping a question isn't. Ordered by importance, and so an answer that removes code comes before questions about that code. Scale the depth to the change, without being asked: a mechanical or small one (a rename, a call-site swap, a deleted wrapper) gets a line per question; anything else gets full answers. Say in one line which you chose and why.

   1. What goes beyond what was asked? Going further than a prompt states is often right; justify each such part, and drop only what has no reason to be there.
   2. Is it correct? Name the input, state or order of events most likely to break it (a second tab writing in between, a write landing mid-await, an empty or missing row) and say why it doesn't.
   3. Does it build a second version of something that already exists — a screen hosting its own copy of what another screen owns, a helper parallel to an existing one? Should it reuse or unify with that instead?
   4. Does it keep CLAUDE.md's rules and landmarks?
   5. Does all new source code run in the app? Nothing unused, and nothing that only tests call (TESTING.md, "Test the code the app runs").
   6. Is there a smaller diff: something reused or deleted instead of added?
   7. Is each new guard needed by the feature, or does it only cover a rare race? If the latter, is it the smallest backstop?
   8. Is each new or changed test at the right layer and in both runners (write-tests skill)? Was it seen to fail first, and seen again after any later change to what it checks or how it waits?
   9. Do the docs in CLAUDE.md's table that cover this area still match the code? Do the names and comments?
   10. Does any comment cite something that won't outlive the session, or run longer than its code needs?
   11. Could the developer you're working with explain every line in an interview? Is anything clever that could be plain?
   12. What in this work was redone, and would a line in a doc have got it right the first time? Flag it for the user to decide; don't add it.

   <!-- To add before 8 once more tests are owned: do new and changed tests match the owned ones (REVIEW.md) in approach and simplicity? -->

   For a broad change, have a fresh agent answer the questions from the diff and the docs alone, without this session's reasoning, then weigh what it finds; it reads the code the way a reviewer will. Fix what's clearly wrong; raise judgment calls with the user.

3. **Verify** to CLAUDE.md's "end of a piece" tier, or the full suites for a broad change, running only what this session hasn't already seen pass since the code it covers last changed. A run from earlier in the session counts; a fix from the review means rerunning what covers it. One line per spec or command: run or already passed, and the result.
4. **Message.** A subject line under ~60 characters, then only what the diff can't say: why, and what a reviewer couldn't find in the code. Keep it short. Write each body paragraph as one line, never hard-wrapped, so it reflows in a narrow pane. Nothing bound to this session: no plan names, step numbers or chat, nothing that won't mean anything in a month. End with a `Co-Authored-By:` trailer for the model drafting it; the user removes it when they see fit.
5. **Size**, as a plain line directly above the message's code block, never inside it. Choose the command that matches the scope from step 1 — `git diff HEAD --shortstat` for everything uncommitted, `git diff --staged --shortstat` for the staged part alone — plus line counts for any untracked files going in.
6. **If this commit completes a plan**, set its Status to `done YYYY-MM-DD` and remove its memory pointer.
