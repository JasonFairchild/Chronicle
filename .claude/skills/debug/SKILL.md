---
name: debug
description: Finding and fixing a bug in Chronicle — a failing or flaky test, wrong behavior in the app, or an error. Use before proposing any fix.
---

# Fixing a bug

No fix before a root cause. A fix that makes the symptom go away without one usually moves the bug.

1. **Reproduce it** as a failing test at the layer where it shows (write-tests skill), failing for the reason the bug names. If it only shows in the app, see it there first (run-app skill), then pin it in a test.
2. **Find the root cause.** Trace the wrong value back to where it was made, and read what the area's doc in CLAUDE.md's table says should hold. Check what changed recently in the files involved. Rule out what has bitten here before: a second tab writing in between, a write landing mid-await, text measured on a ruler other than `docToPlainText`, entries ordered by `created_at` instead of `compareEntries`. A flaky test usually waits on time, or on an absence without a baseline (TESTING.md, Don'ts).
3. **Test one hypothesis at a time**, with the smallest change that would confirm it. Take a failed attempt out before trying the next.
4. **After three failed fixes, stop.** The model of the code is wrong, not the fourth guess. Bring the user what each attempt showed and what that says about the design.
5. **Fix it, and see the test pass.** Then verify to CLAUDE.md's tier for what changed.
6. **Report** the root cause, the invariant the fix relies on, and any edge case the fix opens.
