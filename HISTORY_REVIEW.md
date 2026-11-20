# Applying the history review

Status: next, step 9 (the citations spike). Step 12's trim of the private instructions is already in.

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

Manual check, done in Cypress's open browser on the state the test set up: seal an anchor, then try each toolbar button, a typed key, a paste and a drop on it. Its wording and highlight stay as they were.

### 3. Listing a diff's multi-line comments (C2)

A script in `scripts/` that prints each comment that `git diff HEAD` adds to source, file by file, marking those of more than one line. Only uncommitted work, untracked files included: a comment is listed when any of its lines is new, so changing one line of an old comment lists it, and comments nobody touches wait for a repo-wide pass of their own. TypeScript's compiler finds the comments, so a `//` in a string isn't one, and Vue's SFC parser finds a template's; CSS is left out. cr runs it in its comment question: what repeats is cut, each marked one is cut to a line or kept, and what was kept is reported in a line per file or shared reason. Planted violation: a six-line comment in a config file. Needed: the rule was missed in five batches. Lets cr's comment question shrink (S6), and pairs with the new comment rule (D2).

### 4. Two lint rules, one pass over `eslint.config.js`

Each is seen red on its own planted violation.

- **An empty `catch`, comment or not (C3): tried and reverted.** `no-empty` already fails a catch with nothing in it, so the rule only traded a comment for a disable directive, which reads worse.
- **No relative import into `src/testing/` (C4),** a pattern in every `no-restricted-imports` block, since a later block naming the rule replaces an earlier one's options; inside `src/testing/` a sibling `./` import too. Planted violation: one setup import rewritten as relative. Rare: two instances, the first silent for its whole life.
- **No triple-slash references outside declaration files (C9):** `@typescript-eslint/triple-slash-reference` with `types: 'never'`, every file but `*.d.ts`. Its default only reports a reference whose module the file also imports, so as configured before it missed TESTING's Don't, which then goes in step 8. It fired on `vitest.config.ts`, which now imports `defineConfig` from `vitest/config` instead. Rare: it corrects one of the agent's habits.

### 5. cr skill (`.claude/skills/cr/SKILL.md`)

As landed; the skill has the exact wording.

- **A second definition of one fact (S2), Q3:** its examples gain "a second definition of one fact — or pass data through a component that doesn't own it". The most episodes and rounds of any theme.
- **Following what changed to its readers (S5), Q6:** for what only served the old form, a function now thin enough to inline included, and net source lines first where the change was meant to simplify. Widened from removed shapes to anything the diff changed.
- **The deleted-assertions question (S7, also C6), new Q8,** answered per behaviour, without re-arguing one settled in the session. Rare and cheap, and the only item that would have caught a decided behaviour being removed. Its tier sentence waits for step 15.
- **A guard's unseen ways in (S1), in the guard question (Q7)** rather than correctness: it fires where the diff changes an anchor or draft-safety guard, or adds a way to edit what one protects.
- **Judged against the rule (S3), Q4.**
- **Q5 after the unused-code check (S4):** only what knip can't see.
- **Q11 after the comment listing (S6):** its clause on length goes.
- **Beyond the review:** verify runs first, with `npm run verify` and the unit specs, as evidence for the review; a run named in a pasted handover counts; a question whose premise the diff lacks is skipped and its number listed, in place of a light review for small changes; a fresh agent, its own step, reviews everything but a mechanical change; the split proposal goes; the plan step updates Status at every commit, not only the last, and drops its memory pointer, which write-plan never creates; the note on comparing tests with owned ones moves to REVIEW.md.

### 6. CLAUDE.md

- **The new comment rule (D2)** replaces the first comment rule. Before: "**Comments cite nothing that outlives the session** — no plan, chat, or "Piece N"; cite a checked-in doc or nothing. The non-obvious why, stated once, proportional to the code it sits next to — not a walkthrough. A comment saying what breaks without a line is checked by removing that line." After: "**A comment is one line of non-obvious why, for a reader at that line.** Not what the code says, not why it changed (the commit says that), not what a checked-in doc says (cite the doc, once per file). A second line needs a reason the first can't hold. Cite nothing that outlives the session: no plan, chat, or "Piece N". A comment saying what breaks without a line is checked by removing that line." It names the three ways the old line was missed.
- **Rules are decisions (D1),** opening "Rules": "**These rules are decisions, and they hold in two ways.** Intent holds: PRODUCT.md §2's promises and ENTRY_MODEL.md's two invariants change only when the user changes them. A design rule holds while its reason does, so it is written with its reason. When asked whether one is needed, or when changing what its reason names, check the reason against today's code before citing the rule. If it no longer holds, say so and make the case; never deviate silently."
- **The landmark's expired reason (D3).** Before: "The domain layer reads documents as plain JSON, which keeps it node-testable." After: "The domain layer reads documents as plain JSON today; CHRONICLE_PLAN.md's 'One document model' replaces that."
- **Optional (D3b):** add `anchorIndex.ts` to the landmark's list of files now, rather than with the document-model work.
- **Beyond the review:** D1 says any rule may be questioned on its merits. Cut: the one-command rule; the stack line and "offline is non-negotiable" (README.md, PRODUCT.md §2); the write rule, held by `EntryRepository` having no update or delete; the non-destructive rule, ENTRY_MODEL's first invariant; `compareEntries` (now a hover note on `created_at`); Composition API and the repository layer (its lint fact joins the landmark); dark mode (now a note in `main.css`); small changes; the landmark's plain-JSON status line. "Tests alongside every feature" becomes the TESTING.md row. The verify tiers become one line on what the hooks run; cr, write-plan, debug and write-tests lose their pointers to the tiers, write-plan's a step early. Questioning `reconstructEntryState` goes into CODE_REVIEW.md. The rules left are grouped under four headings, most important first.

### 7. write-plan skill (`.claude/skills/write-plan/SKILL.md`)

Where a plan lives (S8) lands with the docs move, in step 13, since its paths exist only then.

- **What the writer sees change (S9),** a new bullet in step 4 before Decisions: "**What the writer sees change:** before and after in PRODUCT.md's terms, or 'nothing'. A behaviour removed, an interim rule, and what deleted code was meant for are listed here, never among the decisions to check. A change to how writing feels (caret, spacing, focus) names a hands-on pass before review."
- **Steps, not commits (S10).** Before: "**Commits**, in order, each green on its own: what goes in, and its Verify — …" After: "**Steps**, in order, each green on its own and reviewed unstaged: what goes in, and its Verify — … Suggest where commits could fall; the user decides from the diff."
- **A rejected alternative is a judgement (S11),** step 3, after "…tell the user what it raised": "An alternative the agent rejected is recorded as its judgement, not as a decision."
- **Status names the next step (S12).** This rewrites the Status line as changed on 2026-11-14. Now: "what's committed and any check by hand still to run, the manual check included, updated as each lands". _Draft:_ "the next step and any check by hand still to run, the manual check included; `git log` says what's committed". cr's plan step already keeps it current at each commit.
- **A milestone's manual check sits in its step.** _Draft:_ the Manual check bullet ends "A long plan may add one at a milestone that later steps build on, written in that step." A plan's Status has drifted from `git log` four times.

### 8. TESTING.md, with the write-tests skill and `mechanics.md`

As landed; the files have the exact wording. TESTING went from 181 lines to about 120.

- **Six numbered principles, then Layers.** Rules sit under the principle they serve, most important first: tests are evidence (D4), understood without leaving the file, each behavior proven once, proven to fail, the code the app runs, the user's perspective. Layers keeps the table of suffixes and each level's how. The Don'ts, queries, structure and setup sections are gone, and citations read "TESTING.md §N". Step 15 changes D4's "states a sentence" to "is tagged".
- **Expected values imported from the code under test.** "State what a test expects" (§4), added with step 1, gets one pass over the specs. The unused-code check sees only exports no app file imports, so a constant the app imports too (`MEDIA_NODE`, the anchor mark names) is checked by hand.
- **One home each:** no source for tests (D5) in §5, down to what the unused-code check can't see; fail first in a line of §4, with write-tests step 3 keeping what counts as a failure; the mirror in §3, now for every `.browser.test.ts`, mounted or not, while the adapters' mirrors wait on FILE_SPECS.md's `useTabLifecycle` trial.
- **Moved to `mechanics.md`:** the mount paragraph, "Driving the editor", listeners in `attrs`, any Pinia a spec makes, fake trace steps, hiding a tab, and the accessible-name habit. "Import test helpers by alias" shrinks to a clause, now that lint holds it (step 4).
- **Moved to write-tests:** the `defineComponent` and `.only` habits, and looking for a test that already reaches a state before adding one, with the coverage check before deleting one (step 1).
- **Cut:** "Formatting", whose 120 columns `.prettierrc` contradicts; "Running Cypress", which README.md's Scripts table has, now with the flow-only filter; "Known gaps", into CHRONICLE_PLAN's "An end-to-end layer" and FILE_SPECS.md; and the storage mechanism `testStorage.ts` states.
- **Still to move:** "Clearing local data by hand", to README.md in step 11.
- **A write-docs skill** (`.claude/skills/write-docs/SKILL.md`), started here because every step from here edits docs: one home per rule, generic examples, code cited by name, gaps to plans, and the verify commands. write-plan keeps its line on citing by name, without the reason, as a checklist may, and write-tests step 7 keeps only where flagged guidance goes, since the private instructions hold the rule on flagging.

### 9. Citations that resolve: a spike

_Draft,_ beyond the review. Docs, skills and comments cite each other in prose: "TESTING.md §4", "PRODUCT.md §5.4", a bullet's bold lead in quotes. Nothing notices when one dangles, as when a renamed bullet in TESTING.md left FILE_SPECS.md citing it by its old words. If a citation were a link a check resolves, and its text showed on hover, a rule could live in one place and be cited everywhere else instead of copied. The spike finds out what that takes. Adopting it is a step of its own, drafted from what the spike finds.

Next because every later step edits docs that cite each other, and step 13's move into `docs/` rewrites every path a link would carry. Each try runs against TESTING.md and what cites it, on copies in `spikes/citations/`:

- **What VS Code does unaided.** Its built-in Markdown support: validating links to files and headings (`markdown.validate.enabled`), Find All References and Rename on a heading, updating links when a file moves, and what hovering a link shows.
- **Citing below a heading.** A single bullet or table row needs an anchor of its own. Which forms survive Prettier and render on GitHub, such as an inline `<a id>` or an Obsidian-style `^id`, and which of them VS Code and the extensions below resolve.
- **Hover previews,** which the user judges by hand: Foam's previews of wiki-links, and File Ref Tags and Wooref, both unchecked (whether they're maintained, and what each shows). Whether a hover works on a citation in a code comment as well as in a doc. Installing an extension is the user's call.
- **A check that fails on a dangling citation,** for pre-commit beside the unused-code check. An existing tool (`remark-validate-links`) against a script in `scripts/`, which could also read citations in code comments and plain "§N" ones. Planted violation: a citation of a heading renamed away.
- **Reading one snippet, for the agent.** A script printing only the cited section or bullet, say `npm run cite -- TESTING.md#4`, against reading the file or a grep with context. Kept only if it's cheaper in practice, not just in principle.
- **The citation form,** decided from the above: a Markdown link, or a plain "§N" the check resolves; numbered ids, which read like PRODUCT.md's but break on reorder, or named ids, which survive it; and what step 13's move costs each, since relative links from `.claude/skills/` change with it.

Reported in `spikes/citations/README.md`, opened in VS Code: what worked and what didn't, the recommended form and check, and a draft of the adoption step. Verify: the check's prototype seen red on its planted violation.

### 10. One line each in ARCHITECTURE.md and PRODUCT.md

- **The editor reports only its document (D7),** ending ARCHITECTURE's "Write" bullet: "`DocumentEditor` reports only its document. Anything else about the draft (title, details, bookmark, save state) lives in `EntryComposer`: a relay through the editor costs an emit, a handler and a wiring test at each host." The one declined line that was needed again.
- **What was decided, not what the code does (D6),** a second bullet in PRODUCT's header: "This doc records what was decided. What the code happens to do is not a decision: before writing a behaviour found in code into any doc, ask whether it was meant."

### 11. README.md

- **The plain-JSON sentence.** Before: "The domain layer reads documents as plain JSON, so this logic is pure and testable in node." _Draft:_ "This logic is pure functions over plain data, tested in node."
- **The Testing paragraph.** Before: "Unit tests cover only what the UI can't reach — many-case pure logic, timing and races, fault injection —". _Draft:_ "Every source file has a spec of its own: components in both browser runners, everything else in node;". TESTING replaced the old rule on Oct 21.
- **Take in "Clearing local data by hand"** from TESTING, after "Getting started", and delete it there. `chronicleDatabase.ts`'s comment citing TESTING.md for it cites README.md.

### 12. The private instructions, memory, and the plan docs

- **Two lines for the user's private instructions (D8, D9),** untracked, worded in the review.
- **One memory trimmed (R5)** of a paragraph the private instructions already state.
- **Beyond the review, done with step 6:** a trim pass over the private instructions. Cut: small changes, the guard line (cr's Q7), condensing comments, the coverage pass, the commit lines (`git commit` is denied in settings), and the memory section. The rework rule is shortened; "stage only when I ask" joins the review-then-stage line.
- **CHRONICLE_PLAN's line on "TESTING.md's rules beyond drafts… the rest catch up as they're touched":** cut it. What remains is named already: CODE_REVIEW.md's pass over test data, and FILE_SPECS.md.
- **CODE_REVIEW.md's Status** ("no review commits yet") rewritten in the form the Status rule (S12) sets, and its Context's counts (60 files, ~8,900 lines) cut, since they drift.

### 13. Move the docs into `docs/` (R1), and where a plan lives (S8)

- **Reference docs** (ARCHITECTURE, AUTHORING, ENTRY_MODEL, PRODUCT, TESTING, CHRONICLE_PLAN) into `docs/`, by `git mv`.
- **Plan files** (CODE_REVIEW.md, FILE_SPECS.md, this one) into `docs/plans/`, tracked.
- **`spikes/` becomes `docs/spikes/`,** still ignored.
- **A new `docs/retros/`,** mostly ignored. `spikes/history-review/` is the first retro, so it can move there now or later.
- CLAUDE.md and README.md stay at the root.
- **Where a plan lives (S8),** a new first bullet in write-plan's step 4. _Draft:_ "**Where it lives.** In `docs/`, never `~/.claude/plans/`, and opened for the user. It starts in `docs/spikes/<name>/` (ignored). As soon as it's clear it will outlast a session or two, it moves to `docs/plans/` (tracked), linked from its CHRONICLE_PLAN.md item, and is deleted in the commit that finishes it." Step 1's tidy then covers `docs/spikes/` and `docs/plans/`, and cr's plan step deletes a finished plan in `docs/plans/` where today it sets Status to done. Unchecked: whether plan mode's own plan file can be pointed at `docs/` by a setting; if not, the skill says the plan mode file only points to the real one. The one plan left in `~/.claude/plans/`, kept until the connections work is planned, moves to `docs/spikes/`.
- **What follows from the move:** CLAUDE.md's table; the 11 relative links between docs, in 6 files; README.md's links and CHRONICLE_PLAN's link here; the one real path, `'ARCHITECTURE.md'` in `scripts/renderDiagram.ts`; the `.gitignore` and `eslint.config.js` ignores of `spikes`; run-app's `spikes/<name>/` paths; the memory that says where spike results go. All 63 mentions of a doc in `src`, `scripts` and `cypress` are bare names and survive.
- **Why here and not last:** the docs and skill edits before it are done, so no pending text changes path. The steps after it run long, and they're worked out of these folders.
- Verify: `npm run diagram`, `npm run format:check`, `npm run lint`, and a run-app flow from `docs/spikes/`.

### 14. Mutation testing (P2)

- **Spike first,** in a worktree: Stryker's Vitest runner on `anchorGuard.ts` alone. Whether it works with this setup, and whether it can drive Browser Mode at all, are unchecked. If it can't, components are out of its reach.
- **Then a periodic report,** not a gate, since each mutant reruns tests: `anchorGuard.ts`, `anchorIndex.ts`, `draftsStore.ts`, `reconstructEntryState.ts`. It should find the seven tests the review found couldn't fail, without anyone reading them. Each survivor gets a test or a reason.
- **For the portfolio:** its setup and its first scores go in TESTING.md, next to coverage, and the retro skill tracks the score per file.

### 15. The user's PRODUCT.md review, then the two tiers (P1)

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

### 16. One scenario over two drivers (P3)

For the specification tier only, after step 15: a spike on `NewEntryView.flow`, written once over a Browser Mode driver and a Cypress driver. The diff between the drivers is the raw material for the runner write-up.

### 17. The retro skill

Runs the review again over the sessions since a date, and writes into `docs/retros/`. When it's written, it should:

- Repeat the review's two tables, themes and what caught each lesson, over the range covered, and state the range.
- List sentences found in more than one of CLAUDE.md, the private instructions, TESTING.md and the skills. Rare, but it's what keeps step 8's one home per rule true.
- Record memory changes, which git doesn't.
- Count typed prompts without bare slash commands, and give lessons ids unique across runs.
- Track mutation testing's score per file.
