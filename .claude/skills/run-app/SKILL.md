---
name: run-app
description: Launching and driving Chronicle in a real browser — a plan's manual check, a screenshot, or seeing a change work outside the tests. Use instead of starting the dev server by hand.
---

# Running the app

`npm run drive` (`scripts/driveApp.ts`) starts Vite on port 5188, runs a flow in a fresh Chromium, and stops both, so nothing is left listening.

1. **Write a flow** in the scratchpad: a `.ts` module that default-exports `async ({ page, shot }) => { … }`. `page` starts at `/`, and `goto` takes paths relative to it; `shot(name)` saves a screenshot and prints its path. Each run starts with empty IndexedDB, so the flow creates what it needs through the UI.
2. **Look before acting.** On a screen you haven't seen yet, first run a flow that only calls `shot`, read the screenshot, then choose queries by role and label, as the tests do (TESTING.md, "Queries and selectors").
3. **Run it:** `npm run drive -- <flow.ts>`. Read every screenshot it prints. Console and page errors print at the end and fail the run.
4. **Report** what you did in the app and what you saw, pointing to the screenshots that show it.

Port 5199 is Cypress's dev server, up whenever the user has Cypress open; something listening there is expected. If 5188 is taken, Vite exits rather than moving to another port, usually because an earlier run was killed mid-way. Find the owner with `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5188 -State Listen).OwningProcess"`, check it's `node`, then `Stop-Process -Id <pid>`.
