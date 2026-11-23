# Applying the history review

Status: 9d's hover is in, short citations included, its manual check still to run. Next, the rest of 9d from plans checked like any doc, then 9e. Step 12's trim of the private instructions is already in.

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

### 9. Citations that resolve

_Draft,_ beyond the review. Docs, skills and comments cite each other in prose: "TESTING.md §4", "PRODUCT.md §5.4", a bullet's bold lead in quotes. Nothing notices when one dangles, as when a renamed bullet in TESTING.md left FILE_SPECS.md citing it by its old words. With a check that resolves every citation, and a hover that shows what one cites, a rule can live in one place and be cited everywhere else instead of copied.

The spike is done: `spikes/citations/README.md` (ignored) has the trials, the tools tried, and the hand checks. It found 142 citations today, landing on 47 targets, four of them dangling. Adopted next, before step 13: the docs move together, so links between them survive the move, and skills and code cite by bare name.

- **Decision: the form.** Every cited target declares a named id, first on its line, whatever the line is: `### <a id="fail-first"></a>4. A test must be proven to fail`, `- <a id="absence-baseline"></a>**4.3 -** Don't assert absence…`, `## <a id="layers"></a>Layers`. One form, so `<a id=` finds every target and nothing is citable by accident, and the check fails an id used twice in one doc. The id is the rule's short name, named for what it says, and carries no number, so a renumber leaves it alone. A citation shows the number wherever its target has one: a doc cites as a link, `[TESTING.md §4.3](TESTING.md#absence-baseline)`; a skill or code as plain text, `TESTING.md#absence-baseline (§4.3)`, since VS Code gives `SKILL.md` its own `skill` language, whose link check reads a fragment as part of the file name, as TypeScript's hover does. The check fails a shown number the id doesn't land on, so a renumber can't leave a stale one. A bare `§N` inside its own doc stays prose, resolved by number. Rejected in the spike: `^id` and `{#id}`, which nothing resolves and GitHub shows as text; heading slugs, which break on a reword; an id on its own line above a heading, a line more than it needs; `remark-validate-links`, which sees no ids. Rejected since: the number in the id (`4.3-absence-baseline`), which changes every later id on a renumber, and VS Code's rename drops its dot; reference links with a block of definitions at each citing doc's foot; each rule as its own heading, for a slug GitHub and VS Code make themselves; the bold lead as the name, with no `<a id>`, which only our tools would resolve.
- **Decision: rules are numbered,** as PRODUCT.md numbers its sections, so a rule is read and cited as §5.2: TESTING.md's under each principle, two levels; CLAUDE.md's four groups of rules as numbered headings, each rule `1.1`; PRODUCT.md's bullets under §4's, §5's and §6's subsections and §7, to three levels, §6's subsections numbered too so a citation of one says which idea, `4.1.1`. A numbered rule's bold holds only its number and a hyphen, `- **5.2 -** Never mock what's in scope.`, and its sentence follows in plain text, punctuated as prose, since nothing in the bold has to match a citation. TESTING.md's and CLAUDE.md's bold leads go, as the number and id now name a rule; PRODUCT.md's bold stays, as it mostly marks the interface's own words. A one-line rule stays a bullet: a heading is for structure, not for being citable. What has no number, as TESTING.md's Layers, is cited without one.
- **Decision: one resolver, in TypeScript,** loaded by the check and the hover alike. VS Code's runtime (Node 24.22) strips types and `require`s a `.ts` module, so neither needs a build.
- **Decision: our own hover.** rumdl and Marksman preview a heading's section only, Foam the target's first 16 lines, and none reads `<a id>` or a code comment. Ours shows the cited section from any doc, skill or comment, and on a cited heading or bullet, everything citing it.
- **The review's alternatives, rejected as its judgement:** one identifier, either the quoted bold lead everywhere with no ids or numbers, or numbers without ids, which give up the short `§5.2` or let a reorder retarget silently; the hover without the citers direction, which the user wanted and tried; and step 13 before the conversion, which saves nothing, as above.

#### 9a. The citation check

- **`npm run citations`,** from the spike's prototype: every citation in docs, skills and comments, in the forms above and today's prose ones, resolves; a link's shown `§N` matches where it lands. Prefix-only matches are listed, not failed. A file with a `Status:` line is a plan, quoting old wording on purpose, and is skipped. Docs are found at the root or in `docs/`, so step 13 changes nothing here. A skill's files are citable too, by repo path (`.claude/skills/write-tests/mechanics.md#id`), so one skill can cite another's rule rather than copy it. A heading's slug isn't read, since no checked file links to one: such a link dangles.
- **An id used twice in one doc fails.**
- **Once per file, held:** a code file citing the same target twice fails, as the comment rule's "once per file" asks, except in a `/** */` note, which is read alone on hover. Code is read only in its comments, found by the parsers `npm run comments` uses (now shared in `scripts/comments.ts`). They gain CSS's, a component's `<style>` included, so there's one definition of a comment and `npm run comments` lists those too: this reverses step 3's "CSS is left out". Five repeated; four were dropped, and `entriesStore.ts`'s two hover notes stay.
- **`npm run cite -- <citation>`** prints only the cited section or bullet, with its line: 3–20% of the file's bytes in the spike. It reads its argument with the check's own parser, so it takes every form the check does. CLAUDE.md gains a line: follow a citation with `npm run cite` rather than reading its file, unless changing that file.
- **The resolver** (`scripts/citations.ts`) **gets a unit spec,** the first in `scripts/`: a table of citations and what each lands on, a dangle, a stale `§N`. `scripts/comments.ts` gets its own, now that it reads CSS too. The unit project's include gains `scripts/**/*.test.ts`. The check's command line is proven by its planted violations.
- **Pre-commit,** in `scripts/checkStaged.ts` beside the unused-code check, once a run is clean. It takes about 0.2s.
- **The first run's four dangles:** CHRONICLE_PLAN's bare `§5.4` (twice) and `§6` name PRODUCT.md; HISTORY_REVIEW's is a plan's, skipped. Each prefix-only citation is decided with the user: the full lead, or an id in 9b.
- Verify: the spec, seen failing first; the check red on a heading renamed away, and on a link whose `§N` lands elsewhere after two headings swap; then `npm run verify`, which now runs the check too.

#### 9b. Numbers, ids and the conversion

Numbers and ids go in first, reviewed alone; the citers are rewritten after, as their own diff, so the noisy part is read apart.

- **Rules numbered,** in the form above, by script: TESTING.md's, CLAUDE.md's and PRODUCT.md's.
- **Ids on every cited target,** by script: the 42 cited today outside plans (the spike's 47 counted plans' citers too), plus whatever the rewrite newly cites. Each named by hand for what it says, reviewed in the diff. A reworded rule keeps its id; one whose meaning changes gets a new one, with its citers in the same change, which the check lists. What a lasting id buys is only that a reword leaves its citers alone, so a misleading id is never kept for stability's sake. PRODUCT.md's go in now, ahead of its review: ids survive a reorganization that would silently retarget a `§N`.
- **The resolver reads the form:** a numbered rule's number from a bold holding only it, with the rest of its line as its title, so today's quoted citations of a rule still resolve until the rewrite; and a plain citation's `(§N)`, checked as a link's shown number is. A spec row for each.
- **_Draft:_ CLAUDE.md's "Files read top-down" settles helper order,** first under "Where code goes", above "Types live by who uses them". Its first sentence becomes: "A helper goes above its first caller, in the order that caller first uses them, so a file reads in the order its code runs; lint catches functions above callers, but not the order or class methods called through `this`." It is Clean Code's stepdown rule mirrored, helpers first. The name is left out of the rule, since the original puts callers first. Needed: a helper placed well above its caller among other helpers looked out of place, and moving it next to its caller was rework, which a rule giving the order would have settled.
- **TESTING.md §3 says when a script gets a spec:** when it has many-case logic, as the citation check does; glue around other tools (`checkStaged.ts`, `renderDiagram.ts`) is proven by running it.
- **write-docs gains how to cite:** a link in a doc, plain `DOC.md#id (§N)` in a skill or code, the number wherever the target has one, an id on whatever is newly cited, and `npm run citations` holding it. CLAUDE.md's comment rule says "cite the rule, once per file, or once per `/** */` note" for "cite the doc, once per file": a file may cite several rules, but each once outside its hover notes, which 9a's check holds.
- Verify: `npm run citations` green on today's citations, `npm test` for the resolver's spec, `npm run format:check`.

Then the rewrite, as its own diff:

- **Each TESTING.md citation aimed at the rule it means,** now that rules are numbered, each decided with the user. The regroup into principles (d7bb7ad) widened several to a whole principle: run-app's "Queries" became §6, the Don'ts §4 and §5, and "A repository read doesn't retry" became "Flow specs". Citations of other docs keep their targets here; whether they too should narrow is a pass of its own, not yet planned.
- **A citation repeated within one passage,** as CHRONICLE_PLAN's "Connections folded into related entries" cites PRODUCT.md §5.4 six times: where they lean on different parts of it, each cites its rule (5.4.1); where they lean on the same thing, it's cited once. **Decision: a shorthand for the rest of a paragraph.** After one citation of another doc, a bare `§N` in the same paragraph cites that doc, in a doc with no numbers of its own, so a passage leaning on several rules of one section reads as prose; the check fails one beside no other doc or several, which is where a reader couldn't tell either. In a doc with numbers, a bare `§N` is always its own. It resolves by number, so a renumber that moves the rule retargets it unseen, as any bare `§N` in its own doc already can; the renumber script rewrites both. Rejected: the doc last cited anywhere nearby, which leaves the reader to find it.
- **Shorthand held through a renumber:** a shorthand or bare `§N` must land on a target with an id, and the check compares each doc's number-to-id map with HEAD's, failing a bare `§N` that still names a moved or deleted rule's old number, as the renumber script rewrites it. A bare `§N` on a line changed since HEAD is trusted, since a renumber rewrites its citations in the same diff; one hand-edited for another reason and left stale slips through. Pre-commit's `.staged/` copy has no `.git`, but sits inside the repo, so `git show HEAD:<doc>` finds it from there.
- **Resolving split from judging,** so the hover reuses the check's reading: `resolvedCitations` gives each citation in a file its form (`id`, `prose` or `bare`) and its target, reading a shorthand against its doc; the check judges what it returns, and `citedText` reuses it. Shorthand reads only a bare `§N`, so a link to its own doc by name stays a link.
- **The check fails a citation that leaves off its number,** where its target has one, so the rule that a citation shows it holds.
- **Every citation rewritten** to the form above, by script, reviewed as one diff. Then the check rejects what the form rules out: a prose citation of another doc. With quoted titles gone, so is matching by title: `normalize`, the prefix-only list, and a numbered rule's title.
- **Plans are checked too,** for their ids and links, which must resolve; their prose citations are neither checked nor rejected, since a plan quotes old wording on purpose. Some plans live long, as CODE_REVIEW.md does, and a dangling link in one misleads as much as in a doc.
- **Copies become citations.** A rule restated where it's applied, in a skill step or another doc, was cheaper to copy while citing was costly; now each is reconsidered, and cited where a citation reads as well, as write-plan's "cite code by name" cites write-docs' step. The cr skill gets the same pass. Then a light pass over the repo for what is a citation in all but form, a doc named beside a quote or paraphrase the check doesn't read (write-tests' `TESTING.md §3 and "Layers"`), each converted where it profits.
- **write-docs' "One home per rule" and "Cite a doc" merge,** since citing is how one home is kept. Its checklist exception goes with the reason it gave, shared words a search could find, which a citation now does: a step names its action in a few words beside the citation, and the reason stays only at home.
- **"Turn rework into a rule, rarely" moves from the private instructions into CLAUDE.md,** so it can be cited without pointing outsiders at a file they can't see: a paragraph after the Rules preamble, with an id, since both are about the rules themselves rather than the code.
- Verify: `npm run citations`, `npm run format:check`, `npm run verify`.

#### 9c. Helper order held by lint

Surfaced during 9b: CLAUDE.md §3.1 now gives helper order, and says what lint doesn't catch, so it's held by review alone. Done after 9b is committed, before the hover.

- **A local ESLint rule,** since no published one checks order of first use: in a module, setup scope or class, the helpers a function calls sit above it in the order it first calls them. Whether methods called through `this` come in is decided with the user, once a run shows what it flags. It holds many-case logic, so it gets a spec (TESTING.md §3.7).
- **Decided with the user, from the first run's 37 findings:** a function exported, or listed in the object its scope returns, is no helper, since public ones are grouped by topic and gain callers that would each force a move. One still counts between a helper and its user, since the fix always moves the helper; only `readAnchorAnnouncement` sat there, and moved below the last command that announces. A helper first used by a plain statement keeps only its order, so factories sit above what they build. Specs are held too. Methods called through `this` stay out: few, and an adapter's follow its interface; checked by hand once, only `TraceRecorder`'s `events` getter moved, out from between `readClock` and its caller. "First uses" is the order the caller names them, not the order they run: neither fit the code better, and naming order is what the eye checks. A `let` holding a function is a slot, not a helper. A misplaced helper is reported once, against the longest run of its siblings already in order. Every remaining finding was a move, and is made. CLAUDE.md §3.1 now leads with what topic places, then helpers, and names the rule's file.
- Verify: the rule's spec; `npm run lint` over the repo, each finding fixed or the rule narrowed, decided with the user.

#### 9d. The citation hover

- **First, the prose scripts grouped into `scripts/prose/`:** `citations.ts`, `checkCitations.ts`, `cite.ts`, `comments.ts`, `listComments.ts` and their specs, as they read the repo's prose (docs, skills and comments) rather than run or check its code. Done first, so the hover imports the resolver from where it stays; `package.json`'s `citations`, `cite` and `comments` scripts follow. Rejected: `docs`, which step 13's `docs/` folder would make read as scripts for it, and which a comment isn't.
- **A VS Code extension in `tools/citation-hover/`:** a manifest and about 100 lines on the resolver. As landed: it registers for every file and asks the resolver's `citable` whether to read one, so it names no language id and reads what the check reads. It finds the repo by walking up to the resolver itself, not CLAUDE.md, which other projects have too, and imports the repo's live copy, since the installed one sits elsewhere. The resolver gains each citation's column and two lookups, `citedAt` and `citersOf`, each with spec rows. `@types/vscode` as a dev dependency, `tools/` in typecheck and lint. Not knip's entry: its project is `src/` only, where the entry's one finding was `vscode` as unlisted, a module the extension host supplies. README.md says how to install it.
- **Checked first:** that the extension host, not only VS Code's runtime, loads the `.ts` resolver; and whether a folder linked into `~/.vscode/extensions/` loads, else it's packaged with `npx @vscode/vsce package` and the `.vsix` installed, which nothing publishes. Found, in VS Code 1.147 (Node 24.22): the host loads an ESM `extension.ts` and the resolver it imports. A linked folder is marked obsolete and skipped, since VS Code loads only what its `extensions.json` lists, so `npm run hover:package` builds the `.vsix`; it clears `.npmrc`'s preload, whose relative path breaks once the script moves into the extension's folder.
- **Short citations hover too:** a `§N` alone, in its own doc or read against the other doc its paragraph cites, resolved by the check's own rule, since a short citation names its doc least plainly of any form. Called short since, in code and write-docs, for what this plan earlier called bare and shorthand: one form whose doc its context decides, and "bare" already means an insertion without a passage. As landed: both directions read every form the resolver finds, a plan's prose included, so a citer listed on a target can always be hovered back; and a target nothing cites shows no hover, since every id is put on something cited.
- **Landed alongside:** write-tests says to read TESTING.md whole, since its headings name principles, not the rules under them. A Claude Code hook (`scripts/skillHook.ts`, in `.claude/settings.json`) reminds the agent to load write-tests before it edits a spec, and write-docs before a checked-in Markdown file, until its transcript shows that skill loaded: whether to load it had been left to judgment, and was missed on a change to existing specs.
- **_Draft:_ plans checked like any doc.** The exemption goes: a plan's prose citations are rejected and its short citations resolved, as elsewhere. A plan cites what holds today, as a doc does. Wording that lives nowhere else any more is written out whole, uncited, since the plan is then its only home; an example of a citation's form goes in a code span. A long-lived plan has almost no reason to cite an old version at all. Today that's 42 problems: 23 prose citations across CODE_REVIEW, FILE_SPECS and HISTORY_REVIEW, a few landing on targets that need an id, and 19 short citations in HISTORY_REVIEW, most of them examples. Its own diff.
- **_Draft:_ a short citation that could mean two docs fails.** In a doc with numbers, a short citation always means its own doc, so a paragraph that leans on another doc cites it by id each time. When a doc gains numbers, its short citations of another doc switch to meaning its own; most then dangle, which the check reports, but one whose number the doc also has retargets unseen. So the check fails a short citation in a numbered doc whose paragraph cites another doc that has that number too.
- **_Draft:_ the cited rule in its context.** The hover shows the cited heading or rule emphasized, inside the section one level up, which is shown less prominently: a citation of §5.2 shows all of §5, and one of §5.4.1 shows §5.4. The link still opens at the rule's own line, and `npm run cite` still prints only the rule. Checked by hand: whether a long section pushes the rule below the hover's fold, in which case the rule comes first and its context follows.
- **_Draft:_ citations marked in the editor.** A dotted underline in the theme's link color on each citation the resolver finds in docs and comments, never on code itself, so it borrows a color the theme already uses for "this goes somewhere" rather than claiming a new one. Ctrl+click opens the target, through a link provider. A cited heading or rule gets a CodeLens, "cited in N places", as "N references" reads on code. Marks are redrawn as a file changes, unlike a hover, so the repo's files are read once and kept, each reread when it changes, rather than read whole on every hover as now. The check's problems show beside the citation as the editor's own warnings, from the same resolver and the same cache, so a dangling or stale citation is seen as it's typed rather than at pre-commit. Before the backticked links, which mark a symbol cited in prose the same way and its definition and calls never.
- **_Tried, kept if worth it:_ code named in backticks as a link.** A repo path, or a bare file name that only one file has (`entryDocument.ts`), opens that file, with its head on hover. Then symbols: a backticked name (`reconstructEntryState`) found through VS Code's workspace symbol search, the index Ctrl+T uses, linked to its definition and hovered with TypeScript's own hover for it. No id goes in source: the name is the key. And the reverse, on the same index: a cited symbol's declaration says what cites it, as a CodeLens above it ("cited in 2 docs") whose click opens VS Code's peek list of the citers, as "N references" does, and as a section under TypeScript's own hover linking each; both kept if both read well. A CodeLens leaves GitLens's end-of-line blame alone, where a decoration of ours would compete with it; matched by name, so only for a declaration whose name is unique or exported. If these earn their place, a check that every path and symbol a doc names still exists follows, since write-docs says to cite code by name and nothing holds it.
- **Decided with the backticked links above:** the check reads nothing in a code span, as an example of a citation rather than one. If code named in backticks becomes a link, a backticked doc citation would want reading too, and examples would go generic (`GUIDE.md#rule-id`), as write-docs asks of examples anyway. A fenced block is still read, unlike a code span, so its examples report as dangling: blanked here as a code span is (found in 9b's review).
- Manual check, in the repo with it installed: hover a converted citation in a doc, a skill and a code comment, each showing its section with a link that opens at that line; hover a cited heading and a numbered rule, each listing its citers.

#### 9e. The unused-code check over `scripts/` and `tools/`

_Draft,_ beyond the review. Here because 9d grew the scripts to about 2,000 lines and gave the resolver a second consumer, the hover, so its exports became a contract; on its own, and soon. Today knip's project is `src/` only.

- **Each script and the extension an entry,** `scripts/` and `tools/` in the project, specs excluded, `vscode` ignored as a module the extension host supplies. A trial run found three: `helperOrder.ts` unused, since production mode doesn't follow `eslint.config.js`, which wants an entry or the ESLint plugin's own; `citable` unused, since the hover reaches the resolver through a dynamic `import()` knip can't follow, so it takes a `@keep` with that reason; and `Problem` exported but used only inside the resolver, so the export goes.
- Verify: `npm run unused` red on a planted export only a script's spec imports, then `npm run verify`.

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
- **What follows from the move:** CLAUDE.md's table; the relative links between docs and to plans, citations included since step 9b; README.md's links and CHRONICLE_PLAN's link here; the one real path, `'ARCHITECTURE.md'` in `scripts/renderDiagram.ts`; the `.gitignore` and `eslint.config.js` ignores of `spikes`; run-app's `spikes/<name>/` paths; the memory that says where spike results go. All 63 mentions of a doc in `src`, `scripts` and `cypress` are bare names and survive.
- **Why here and not last:** the docs and skill edits before it are done, so no pending text changes path. The steps after it run long, and they're worked out of these folders.
- Verify: `npm run citations`, `npm run diagram`, `npm run format:check`, `npm run lint`, and a run-app flow from `docs/spikes/`.

### 14. Mutation testing (P2)

- **Spike first,** in a worktree: Stryker's Vitest runner on `anchorGuard.ts` alone. Whether it works with this setup, and whether it can drive Browser Mode at all, are unchecked. If it can't, components are out of its reach.
- **Then a periodic report,** not a gate, since each mutant reruns tests: `anchorGuard.ts`, `anchorIndex.ts`, `draftsStore.ts`, `reconstructEntryState.ts`. It should find the seven tests the review found couldn't fail, without anyone reading them. Each survivor gets a test or a reason.
- **For the portfolio:** its setup and its first scores go in TESTING.md, next to coverage, and the retro skill tracks the score per file.

### 15. The user's PRODUCT.md review, then the two tiers (P1)

- **The user reviews PRODUCT.md** against their vision first, at their pace. The tiers attach to the result.
- **Then the line.** A specification test states one sentence from the docs, in the doc's words, and stays true under any redesign that keeps the behaviour; everything else is a correctness test, free to change with the design. Start narrow: PRODUCT §2's promises, AUTHORING's Draft safety table and ENTRY_MODEL's two invariants, with §4's built behaviours added once the narrow tier proves quiet. The cost of starting narrow: the coverage script below misses §4 gaps until then.
- **The tag:** the title starts with what it states, as `'Draft safety: reopens what was typed after a reload'`. No helper or import, Vitest filters on it with `-t`, a script can grep it. Renumbering a doc renames its tests. Rejected: a `spec()` wrapper, which adds an import to every spec using it.
- **_Draft:_ the tag is a citation** (step 9), so the doc line a test states is exact and checked: the title starts with the cited id, as `'AUTHORING.md#reopens-typed: reopens what was typed after a reload'`, and the citation check reads a test's title as well as comments. A one-line comment above the test is the fallback if titles prove awkward. The docs may then be reorganized, as rows or tables, so each behaviour is one citable line no two tests state.
- **The first tags,** from the review's candidate list, as it stands after the PRODUCT.md review.
- **When the agent raises a tagged test:** only when a diff changes or deletes one of its assertions, once, in the plan before the change. Never when reading one or adding tests beside one.
- **What follows:**
  - The deleted-assertions question (S7) gains its last sentence: "In a specification test, a behaviour that goes needs the user's yes before the change, not in the handover."
  - "Tests are evidence" (D4) says "is tagged" for "states a sentence".
  - **The spec coverage script (C7):** lists each doc row in the tier that no tagged test states, the citation check's reverse lookup. It also does what naming tests in the Draft safety table (T2) would have, so the table stays as it is.
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
