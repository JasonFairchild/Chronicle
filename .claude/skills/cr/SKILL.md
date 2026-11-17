---
name: cr
description: Verify, review and draft a commit message for uncommitted work. Use when asked to review it, whether it's ready to commit, or for a commit message. Never commits.
---

# Getting a commit ready

Run when the user asks, not after every turn. The commit is everything uncommitted, `git diff HEAD` plus untracked files, unless the user says otherwise. Verification comes first, as evidence for the review; the message comes last, about what survived. Report in the order of the steps.

1. **Verify** with `npm run verify` and the specs CLAUDE.md's tiers call for at the end of a piece. Skip what has been seen to pass since the code it covers last changed, in this session or in a pasted handover that names the run. A failure is the review's first finding. After the review, rerun what covers any fix it made. One line per spec or command: run or already passed, and the result.
2. **A fresh agent** answers step 3's questions in the background, unless the change is mechanical (a rename, a call-site swap, a doc edit that leaves every rule and decision as it was). It gets the diff, the docs and verify's output, without this session's reasoning: it reads the code the way a reviewer will, though it can't answer what needs this session.
3. **Review** by answering each question for this diff, with evidence, then weigh what the agent finds. Fix what's clearly wrong; raise judgment calls with the user. "Nothing" is an answer. A question whose premise the diff lacks (no comment added, no guard touched) is skipped, and the skipped numbers go in one closing line. Ordered by importance, and so an answer that removes code comes before questions about that code.
   1. What goes beyond what was asked? Going further than a prompt states is often right; justify each such part, and drop only what has no reason to be there.
   2. Is it correct? Name the input, state or order of events most likely to break it (a second tab writing in between, a write landing mid-await, an empty or missing row) and say why it doesn't.
   3. Does it build a second version of something that already exists — a screen hosting its own copy of what another screen owns, a helper parallel to an existing one, a second definition of one fact — or pass data through a component that doesn't own it? Should it reuse or unify with that instead?
   4. Does it keep CLAUDE.md's rules and landmarks, judged against the rule and not against neighbouring code?
   5. Does anything in source exist for a spec that the unused-code check can't see: an optional field or parameter, an attribute, a wrapper element?
   6. Is there a smaller diff: something reused or deleted instead of added? Check the readers of what the diff changed for what only served the old form: a branch, fallback, name or test, or a function now thin enough to inline. Where it was meant to simplify, give net source lines first, and if they grew, say what the growth buys.
   7. Is each new guard needed by the feature, or does it only cover a rare race? If the latter, is it the smallest backstop? Where the diff changes a guard on anchors or on draft safety, or adds a way to edit what one protects, name a way in that the guard doesn't see, or say why there is none.
   8. Did any spec lose assertions? Answer per behaviour, not per assertion: moved (name where), gone (name it, and where the user decided it; if that was this session, say so and don't re-argue it), or it pinned how and not what. A behaviour that goes needs the user's yes before the change, not in the handover.
   9. Is each new or changed test at the right layer and in both runners (write-tests skill)? Was it seen to fail first, and seen again after any later change to what it checks or how it waits?
   10. Do the docs in CLAUDE.md's table that cover this area still match the code? Do the names and comments?
   11. Does any comment cite something that won't outlive the session, or repeat what another comment in the file (above all a nearby one) or a doc already says? `npm run comments` lists each comment the diff adds or changes, file by file, marking those of more than one line. Read each file's list together: cut what repeats, and cut each marked comment to a line or keep it. Report the marked ones kept in one line per file or shared reason, not per comment.
   12. Could the developer you're working with explain every line in an interview? Is anything clever that could be plain?
   13. What in this work was redone, and would a line in a doc have got it right the first time? Flag it for the user to decide; don't add it.
4. **If this commit is part of a plan**, update its Status to read true once this commit lands, or `done YYYY-MM-DD` if it finishes the plan.
5. **Size**, as a plain line directly above the message's code block, never inside it: `git diff HEAD --shortstat` plus line counts for untracked files, or `git diff --staged --shortstat` when the commit is only what's staged.
6. **Message.** A subject line under ~60 characters, then only what the diff can't say: why, and what a reviewer couldn't find in the code. Keep it short. Write each body paragraph as one line, never hard-wrapped, so it reflows in a narrow pane. Nothing bound to this session: no plan names, step numbers or chat, nothing that won't mean anything in a month. End with a `Co-Authored-By:` trailer for the model drafting it; the user removes it when they see fit.
