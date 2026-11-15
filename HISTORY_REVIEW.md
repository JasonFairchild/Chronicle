# Applying the history review

Status: steps 1 and 2 committed. Next: step 3, listing a diff's multi-line comments.

## Context

A review of every past session that still exists, looking for the places where the user's pushback moved the design somewhere better, and asking what could have caught each lesson without the user reading code. Its evidence and argument live locally in `spikes/history-review/` (ignored). This file is its proposals as steps. It grew out of CHRONICLE_PLAN.md priority 1, the code review, which links here; none of its work goes into CHRONICLE_PLAN.md yet. Everything is tried, and an item that doesn't earn its place once it's in is reverted like any other change.

## Decisions

- **One step is one file's pass, or one check,** reviewed unstaged, so each file is opened once and takes everything meant for it. Where commits fall is the user's call.
- **Order:** checks first, because every lesson that moved into a check stayed fixed, while seven prose rules were broken after they were written. Then the docs and skills by how much rework they caused, then the docs move, then the long-running work: mutation testing, PRODUCT.md and the two tiers, the retro skill.
- **Each item has a short name, and its code from the review's list of decisions as a handle,** as "the unused-code check (C1)". A cross-reference always gives the name.
- **The two tiers wait for the user's PRODUCT.md review,** so tests are tied to the doc once it says what's meant, not before. The items whose form the tiers decide are written without them first, each needing at most a phrase changed later: "tests are evidence" (D4) says "states a sentence" until it can say "is tagged", and the deleted-assertions question (S7) lands without its last sentence. Naming a test beside each Draft safety row (T2) moves into the tiers step, where a script does it.
- **Wording marked _draft_ is new here;** the rest is the review's, unchanged.
- **Verify:** a doc or skill edit runs `npm run format:check`. A check is seen red on its planted violation, then `npm run verify`. A test is seen failing first, in both runners.
- **Not planned:** a report of text a spec asserts that belongs to another component (C5). It was the weakest proposal, and mutation testing covers the same ground.

## Steps

### 1. The unused-code check (C1)

knip as a dev dependency, in production mode, so specs and `src/testing/` don't count as users: an export only a spec imports is reported. An `npm run unused` script, run from `verify`.

- **Code unused on purpose stays, tagged.** A custom tag, `/** @keep <why> */` with `"tags": ["-keep"]`, excludes an export, and the why is the tag's text. A file nobody imports yet goes in `entry`, with its reason beside it in `knip.jsonc`, which allows comments: its imports then count as used, unlike `ignoreFiles`. Neither is flagged once the file gains a caller, so the line is removed by hand. When a kept export gains a real caller, knip reports the tag as unneeded, so a tag can't outlive its reason. Rejected: knip's `@internal`, which production mode exempts, because it excuses exactly what this check exists to find, source only specs run. Also rejected: commenting the code out, which drops it from typecheck, so it rots unseen.
- **The first run lists today's leftovers.** Each is deleted or tagged with the user, one at a time.
- **Pre-commit once a run is clean,** in `scripts/checkStaged.ts` beside typecheck and the unit tests, since a run takes about 2s. Planted violation: a store export only its spec imports.
- Needed: six episodes over five weeks. It lets cr's Q5 (S4) and TESTING's "Test the code the app runs" (D5) shrink, in steps 5 and 8.

Tried: knip's Vite, Vitest and Cypress plugins find every entry here without config.

### 2. The sealed-anchor table test (T1)

In the `DocumentEditor` pair, on a document with a sealed anchor: every toolbar button found in the rendered toolbar (`toolbarGroups` is a computed inside `EditorToolbar.vue`, not an export), a typed key, a paste and a drop, each leaving the anchors as they were. A new button joins the table without anyone remembering. Seen failing by breaking the guard for one way in. Needed: the costliest theme, and found by luck three times out of four.

### 3. Listing a diff's multi-line comments (C2)

A script in `scripts/` that prints each comment of more than one line that `git diff HEAD` adds to source. cr runs it before its comment question, and each one is cut to a line or justified in the handover. Planted violation: a six-line comment in a config file. Needed: the rule was missed in five batches. Lets cr's Q10 shrink (S6), and pairs with the new comment rule (D2).

### 4. Three lint rules, one pass over `eslint.config.js`

Each is seen red on its own planted violation.

- **An empty `catch`, comment or not (C3),** by `no-restricted-syntax`. It fires on `useStoragePersistence.ts`, the one today, which then gets a reason in code or a disable saying why. Rare: one episode, three lines of config.
- **No relative import into `src/testing/` (C4),** joining the existing `no-restricted-imports` block, since a second block for the same files replaces the first. Planted violation: one setup import rewritten as relative. Rare: two instances, the first silent for its whole life.
- **No triple-slash references in specs (C9):** `@typescript-eslint/triple-slash-reference` with `types: 'never'` for spec files. Its default only reports a reference whose module the file also imports, so as configured today it misses TESTING's Don't, which then goes in step 8. Rare: it corrects one of the agent's habits.

### 5. cr skill (`.claude/skills/cr/SKILL.md`)

Added words are bold.

- **A second definition of one fact (S2), Q3:** "…a helper parallel to an existing one**, a second definition of one fact — or pass data through a component that doesn't own it**? Should it reuse or unify with that instead?" The most episodes and rounds of any theme.
- **Following a removed shape's readers (S5), Q6:** "Is there a smaller diff: something reused or deleted instead of added? **Where the change removes or replaces a shape, follow its readers for the branches, fallbacks, names and tests that only served it. Where it was meant to simplify, give net source lines first, and if they grew, say what the growth buys.**"
- **The deleted-assertions question (S7, also C6), new before Q8:** "**Did any spec lose assertions?** For each one say which it is: moved (name where), the behaviour is gone (name it, and where the user decided it), or it pinned how and not what. A behaviour that goes needs the user's yes before the change, not in the handover." Renumbers 8 to 12. Rare and cheap, and the only item that would have caught a decided behaviour being removed. Its tier sentence waits for step 14.
- **A guard's unseen ways in (S1), end of Q2:** "**Where the diff touches a guard on anchors or on draft safety, name a way in that the guard doesn't see, or say why there is none.**"
- **Judged against the rule (S3), Q4:** "Does it keep CLAUDE.md's rules and landmarks**, judged against the rule and not against neighbouring code**?"
- **Q5 after the unused-code check (S4).** Replace with: "Does anything in source exist for a spec that the unused-code check can't see: an optional field or parameter, an attribute, a wrapper element?"
- **Q10 after the comment listing (S6).** Keep its first half: "Does any comment cite something that won't outlive the session?"

### 6. CLAUDE.md

- **The new comment rule (D2)** replaces the first comment rule. Before: "**Comments cite nothing that outlives the session** — no plan, chat, or "Piece N"; cite a checked-in doc or nothing. The non-obvious why, stated once, proportional to the code it sits next to — not a walkthrough. A comment saying what breaks without a line is checked by removing that line." After: "**A comment is one line of non-obvious why, for a reader at that line.** Not what the code says, not why it changed (the commit says that), not what a checked-in doc says (cite the doc, once per file). A second line needs a reason the first can't hold. Cite nothing that outlives the session: no plan, chat, or "Piece N". A comment saying what breaks without a line is checked by removing that line." It names the three ways the old line was missed.
- **Rules are decisions (D1),** opening "Rules": "**These rules are decisions, and they hold in two ways.** Intent holds: PRODUCT.md §2's promises and ENTRY_MODEL.md's two invariants change only when the user changes them. A design rule holds while its reason does, so it is written with its reason. When asked whether one is needed, or when changing what its reason names, check the reason against today's code before citing the rule. If it no longer holds, say so and make the case; never deviate silently."
- **The landmark's expired reason (D3).** Before: "The domain layer reads documents as plain JSON, which keeps it node-testable." After: "The domain layer reads documents as plain JSON today; CHRONICLE_PLAN.md's 'One document model' replaces that."
- **Optional (D3b):** add `anchorIndex.ts` to the landmark's list of files now, rather than with the document-model work.

### 7. write-plan skill (`.claude/skills/write-plan/SKILL.md`)

Where a plan lives (S8) lands with the docs move, in step 12, since its paths exist only then.

- **What the writer sees change (S9),** a new bullet in step 4 before Decisions: "**What the writer sees change:** before and after in PRODUCT.md's terms, or 'nothing'. A behaviour removed, an interim rule, and what deleted code was meant for are listed here, never among the decisions to check. A change to how writing feels (caret, spacing, focus) names a hands-on pass before review."
- **Steps, not commits (S10).** Before: "**Commits**, in order, each green on its own: what goes in, and its Verify — …" After: "**Steps**, in order, each green on its own and reviewed unstaged: what goes in, and its Verify — … Suggest where commits could fall; the user decides from the diff."
- **A rejected alternative is a judgement (S11),** step 3, after "…tell the user what it raised": "An alternative the agent rejected is recorded as its judgement, not as a decision."
- **Status names the next step (S12).** This rewrites the Status line as changed on 2026-11-14. Now: "what's committed and any check by hand still to run, the manual check included, updated as each lands". _Draft:_ "the next step and any check by hand still to run, the manual check included; `git log` says what's committed". A plan's Status has drifted from `git log` four times.

### 8. TESTING.md, with the write-tests skill and `mechanics.md`

One pass, since text moves between the three. TESTING goes from 181 lines to about 140.

- **Expected values imported from the code under test.** "State what a test expects", added to "Philosophy" with step 1, gets one pass over the specs. The unused-code check sees only exports no app file imports, so a constant the app imports too (`MEDIA_NODE`, the anchor mark names) is checked by hand.
- **Tests are evidence (D4),** added to "Philosophy": "**A test is evidence of what the code does. It is a specification only where it states a sentence from PRODUCT.md, AUTHORING.md or ENTRY_MODEL.md.** Check behaviour against the doc, not against the test. Where the two disagree, or a test pins something nothing reads, raise it; don't conform to it." Step 14 changes "states a sentence" to "is tagged".
- **Fail first, one home.** The "Use a fail first approach" bullet takes write-tests step 2's stronger wording ("It must fail on its assertion, for the reason the test names…", each claim seen failing). Step 2 becomes a pointer.
- **No source for tests, one home (D5).** The "Test the code the app runs" bullet absorbs the Don't about changing source and loosening types, and the Don't goes. Then the bullet shrinks to what the unused-code check can't see: a loosened type, an optional field or parameter, an attribute.
- **Mirrored specs, one home.** _Draft:_ "**Component and flow specs are mirrored on purpose.** Every `.browser.test.ts` that mounts something has a `.cy.ts` with the same cases, to compare the two runners; flows pair the same way. Don't consolidate them." It replaces "Duplicate specs are intentional" and "Cypress should keep up…", and the intro drops its clause on duplication. write-tests step 3 points to it.
- **Mount, one home.** The Don't "Don't import `mount` directly" and Setup's "Mount through the shared helper" say the same thing; the Don't stays.
- **Cut "Formatting"** (12 lines). `.prettierrc` sets a print width of 100, so its "roughly 120" is already wrong, and its last sentence is in "Structure and naming".
- **Cut "Running Cypress"** (3 lines). README.md's Scripts table has it.
- **Move "Clearing local data by hand" to README.md** (12 lines), in step 10. It's a developer's procedure.
- **Move "Known gaps" out** (5 lines). The first bullet merges into CHRONICLE_PLAN's "An end-to-end layer"; the second goes to FILE_SPECS.md, which already lists the read-only related draft.
- **Coverage's second paragraph to two sentences.** _Draft:_ "`npm run test:coverage` runs both Vitest projects and writes `coverage/`. The provider is istanbul, since v8 can't instrument Browser Mode; Cypress isn't wired in yet."
- **Move the mount paragraph and "Driving the editor" to `mechanics.md`.** "Don't import `mount` directly" is the one-line rule left behind.
- **Move the habit Don'ts to write-tests:** `defineComponent` in component tests and removing an existing `.only`. The triple-slash one is gone with its lint rule (step 4). FILE_SPECS.md's commit 8 would amend the first, so the two are decided together.
- **The placing question, one home.** write-tests step 1 becomes a pointer to "Layers".
- `mechanics.md`'s "Import test helpers by alias" shrinks to a clause, now that lint holds it (step 4).

### 9. One line each in ARCHITECTURE.md and PRODUCT.md

- **The editor reports only its document (D7),** ending ARCHITECTURE's "Write" bullet: "`DocumentEditor` reports only its document. Anything else about the draft (title, details, bookmark, save state) lives in `EntryComposer`: a relay through the editor costs an emit, a handler and a wiring test at each host." The one declined line that was needed again.
- **What was decided, not what the code does (D6),** a second bullet in PRODUCT's header: "This doc records what was decided. What the code happens to do is not a decision: before writing a behaviour found in code into any doc, ask whether it was meant."

### 10. README.md

- **The plain-JSON sentence.** Before: "The domain layer reads documents as plain JSON, so this logic is pure and testable in node." _Draft:_ "This logic is pure functions over plain data, tested in node."
- **The Testing paragraph.** Before: "Unit tests cover only what the UI can't reach — many-case pure logic, timing and races, fault injection —". _Draft:_ "Every source file has a spec of its own: components in both browser runners, everything else in node;". TESTING replaced the old rule on Oct 21.
- **Take in "Clearing local data by hand"** from TESTING, after "Getting started".

### 11. The private instructions, memory, and the plan docs

- **Two lines for the user's private instructions (D8, D9),** untracked, worded in the review.
- **One memory trimmed (R5)** of a paragraph the private instructions already state.
- **CHRONICLE_PLAN's line on "TESTING.md's rules beyond drafts… the rest catch up as they're touched":** cut it. What remains is named already: CODE_REVIEW.md's pass over test data, and FILE_SPECS.md.
- **CODE_REVIEW.md's Status** ("no review commits yet") rewritten in the form the Status rule (S12) sets, and its Context's counts (60 files, ~8,900 lines) cut, since they drift.

### 12. Move the docs into `docs/` (R1), and where a plan lives (S8)

- **Reference docs** (ARCHITECTURE, AUTHORING, ENTRY_MODEL, PRODUCT, TESTING, CHRONICLE_PLAN) into `docs/`, by `git mv`.
- **Plan files** (CODE_REVIEW.md, FILE_SPECS.md, this one) into `docs/plans/`, tracked.
- **`spikes/` becomes `docs/spikes/`,** still ignored.
- **A new `docs/retros/`,** mostly ignored. `spikes/history-review/` is the first retro, so it can move there now or later.
- CLAUDE.md and README.md stay at the root.
- **Where a plan lives (S8),** a new first bullet in write-plan's step 4. _Draft:_ "**Where it lives.** In `docs/`, never `~/.claude/plans/`, and opened for the user. It starts in `docs/spikes/<name>/` (ignored). As soon as it's clear it will outlast a session or two, it moves to `docs/plans/` (tracked), linked from its CHRONICLE_PLAN.md item, and is deleted in the commit that finishes it." Step 1's tidy then covers `docs/spikes/` and `docs/plans/`, and cr's step 6 deletes a finished plan in `docs/plans/` where today it sets Status to done. Unchecked: whether plan mode's own plan file can be pointed at `docs/` by a setting; if not, the skill says the plan mode file only points to the real one. The one plan left in `~/.claude/plans/`, kept until the connections work is planned, moves to `docs/spikes/`.
- **What follows from the move:** CLAUDE.md's table; the 11 relative links between docs, in 6 files; README.md's links and CHRONICLE_PLAN's link here; the one real path, `'ARCHITECTURE.md'` in `scripts/renderDiagram.ts`; the `.gitignore` and `eslint.config.js` ignores of `spikes`; run-app's `spikes/<name>/` paths; the memory that says where spike results go. All 63 mentions of a doc in `src`, `scripts` and `cypress` are bare names and survive.
- **Why here and not last:** the docs and skill edits before it are done, so no pending text changes path. The steps after it run long, and they're worked out of these folders.
- Verify: `npm run diagram`, `npm run format:check`, `npm run lint`, and a run-app flow from `docs/spikes/`.

### 13. Mutation testing (P2)

- **Spike first,** in a worktree: Stryker's Vitest runner on `anchorGuard.ts` alone. Whether it works with this setup, and whether it can drive Browser Mode at all, are unchecked. If it can't, components are out of its reach.
- **Then a periodic report,** not a gate, since each mutant reruns tests: `anchorGuard.ts`, `anchorIndex.ts`, `draftsStore.ts`, `reconstructEntryState.ts`. It should find the seven tests the review found couldn't fail, without anyone reading them. Each survivor gets a test or a reason.
- **For the portfolio:** its setup and its first scores go in TESTING.md, next to coverage, and the retro skill tracks the score per file.

### 14. The user's PRODUCT.md review, then the two tiers (P1)

- **The user reviews PRODUCT.md** against their vision first, at their pace. The tiers attach to the result.
- **Then the line.** A specification test states one sentence from the docs, in the doc's words, and stays true under any redesign that keeps the behaviour; everything else is a correctness test, free to change with the design. Start narrow: PRODUCT §2's promises, AUTHORING's Draft safety table and ENTRY_MODEL's two invariants, with §4's built behaviours added once the narrow tier proves quiet. The cost of starting narrow: the coverage script below misses §4 gaps until then.
- **The tag:** the title starts with what it states, as `'Draft safety: reopens what was typed after a reload'`. No helper or import, Vitest filters on it with `-t`, a script can grep it. Renumbering a doc renames its tests. Rejected: a `spec()` wrapper, which adds an import to every spec using it.
- **The first tags,** from the review's candidate list, as it stands after the PRODUCT.md review.
- **When the agent raises a tagged test:** only when a diff changes or deletes one of its assertions, once, in the plan before the change. Never when reading one or adding tests beside one.
- **What follows:**
  - The deleted-assertions question (S7) gains its last sentence: "In a specification test, a behaviour that goes needs the user's yes before the change, not in the handover."
  - "Tests are evidence" (D4) says "is tagged" for "states a sentence".
  - **The spec coverage script (C7):** lists each doc row in the tier that no tagged test states. It also does what naming tests in the Draft safety table (T2) would have, so the table stays as it is.
  - FILE_SPECS.md's 17 not-started commits (R4) are all correctness-tier work: keep, cut or reorder them, with mutation testing's report showing which missing specs matter.

### 15. One scenario over two drivers (P3)

For the specification tier only, after step 14: a spike on `NewEntryView.flow`, written once over a Browser Mode driver and a Cypress driver. The diff between the drivers is the raw material for the runner write-up.

### 16. The retro skill

Runs the review again over the sessions since a date, and writes into `docs/retros/`. When it's written, it should:

- Repeat the review's two tables, themes and what caught each lesson, over the range covered, and state the range.
- List sentences found in more than one of CLAUDE.md, the private instructions, TESTING.md and the skills. Rare, but it's what keeps step 8's one home per rule true.
- Record memory changes, which git doesn't.
- Count typed prompts without bare slash commands, and give lessons ids unique across runs.
- Track mutation testing's score per file.

## Manual check

After step 2: in the running app, seal an anchor, then try each toolbar button, a typed key, a paste and a drop on it. Its wording and highlight stay as they were.
