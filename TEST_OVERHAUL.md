# Test overhaul — working plan

The working plan for CHRONICLE_PLAN.md priority 1, carried across sessions. Temporary: when the
overhaul is done, what lasts is folded into [TESTING.md](./TESTING.md) and this file is deleted.
Rules live in TESTING.md ("Layers" especially) and are linked here, not repeated.

## Scope

Drafts first; lessons are then applied to later tests. In scope:

- The draft-related tests in the `EntryForm`, `EntryDetailView`, `NewConnectionView` and
  `DraftsView` specs, in both runners
- `src/stores/draftsStore.test.ts`, and the draft cases in `src/stores/entriesStore.test.ts`
- `src/repositories/draftRepository.contract.ts` and `dexieDraftRepository.browser.test.ts`

## Current state

- **Component specs are already narrow end-to-end tests.** `src/testing/realRepositories.ts` points
  the composition root at a real Dexie database, unique per test and shared by entries and drafts as
  in production. Nothing below the component is mocked. What they lack: the app shell (`App.vue`,
  which owns flush-on-leave and the drafts' tab-return check), real reloads, a second tab.
- **Specs couple to the backend more than they need to.** They type storage as `DexieDraftRepository`
  / `DexieEntryRepository`, and several assert through the repository where the UI could show it.
  The types were fixed in Pass 1.
- **Unit and component levels overlap.** Of `draftsStore.test.ts`'s ~34 cases, roughly a quarter
  duplicate component coverage, roughly a third are user-visible behavior tested only in the store,
  and the durability and race cases are the store's real reason for unit tests.
- **Runner parity has drifted.** `EntryDetailView.browser.test.ts` has four tests with no Cypress
  mirror: "offers the draft already in progress on an entry rather than a second one", "shows the
  version another tab saved once this tab is returned to", "offers the draft another tab has only
  just opened on an entry, before a word is typed", "saves a revision that only changes formatting".
  Mirrored in Pass 1.

## Why the draft code exists

The inventory every pass is measured against. Sources: PRODUCT.md §4.1, §4.5, §4.8; AUTHORING.md
"Drafts". Checked against what each spec asserts at the end of Pass 1 (2026-09-30); what the
check found is under the tables. "EDV" is `EntryDetailView`.

### User-visible

| #   | Behavior                                                                     | Covered now                                                 | Target                    |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| U1  | Typing is kept as a draft; nothing reaches the timeline until saved          | EntryForm, both runners                                     | component ✓               |
| U2  | A composer opened and left writes nothing                                    | EntryForm, both runners; store (weak)                       | component ✓               |
| U3  | Leaving mid-draft keeps it                                                   | EntryForm, EDV, NewConnectionView                           | component ✓               |
| U4  | Drafts page: what each would become, when touched, preview, newest first     | DraftsView                                                  | component ✓               |
| U5  | Resume where it left off: words, title, dates; anchor mode on both halves    | DraftsView; EDV resumes a revision's words                  | component ✓               |
| U6  | Saving a resumed draft makes one entry and removes the draft                 | DraftsView                                                  | component ✓               |
| U7  | Discard removes it — the only thing that does — for any listed draft         | DraftsView; composers in Browser Mode only; store           | component                 |
| U8  | A draft emptied of its words disappears                                      | EntryForm; store                                            | component ✓               |
| U9  | One draft per entry: **Resume draft** replaces Revise and Create related     | EDV, both runners                                           | component ✓               |
| U10 | Leaving an untouched claim frees the entry                                   | EDV; store                                                  | component ✓               |
| U11 | A stale version refuses the save, says why, and the draft stays              | DraftsView (a revision; not the anchor-mode wording); store | component ✓               |
| U12 | An unreadable draft says why, shows all its text, and can still be discarded | DraftsView                                                  | component ✓               |
| U13 | Tab return reloads a newer draft, or closes one sealed elsewhere and says so | store only (the entry-refresh half is in EDV)               | spike component, else E2E |
| U14 | Two tabs save at once: the first wins, the other shows its text to copy      | store only                                                  | spike component, else E2E |
| U15 | After saving, the composer is empty; an empty entry can't be saved           | EntryForm and the other composers                           | component ✓               |
| U16 | A revision saves formatting alone; one that changes nothing is refused       | EDV                                                         | component ✓               |

### Durability the user can't see

Unit tests, unless a pass finds a component spec that drives one deterministically.

| #   | Behavior                                                                     | Covered now            |
| --- | ---------------------------------------------------------------------------- | ---------------------- |
| I1  | Flush within `DRAFT_FLUSH_MS`, throttled rather than debounced               | store (one burst only) |
| I2  | Leaving a tab flushes at once (`pagehide` / hidden → `flushAll`)             | **nothing**            |
| I3  | A failed write stays pending for the next chance                             | store                  |
| I4  | Seal and discard wait for a flush already writing, so nothing is resurrected | store (seal only)      |
| I5  | Seal is one transaction; a refused seal leaves the draft                     | contract               |
| I6  | Event logs are append-only; a conflicting append refuses the whole save      | contract (entry log)   |
| I7  | The stored draft doesn't share the caller's object                           | contract               |
| I8  | A claim is written at begin, before anything is typed                        | store; EDV             |
| I9  | Releasing a claim is judged on what disk holds                               | store                  |
| I10 | A resume continues the trace: events carry on, `started_at` is kept          | store                  |

### What the check found

Component specs named without a runner cover both.

- **U2.** The store's "writes nothing for a composer that was opened and walked away from" never
  lets the session go, so it reads before any flush could land, as the old EntryForm test did.
- **U4.** The page labels four kinds; only "Related entry on" is asserted. The preview appears only
  as the wait before Resume or Discard.
- **U6.** Cypress destructures the first root entry; only Browser Mode checks there is exactly one.
- **U7.** In EDV and NewConnectionView, only Browser Mode shows Discard reaching disk, through
  waits written as cleanup ("will not save a related entry that says nothing", "abandons a
  revision…", "will not add a connection with no content"). The Cypress mirrors click and stop.
- **U10.** The old row credited EDV, but "abandons a revision without touching the entry" discards
  typed work. It doesn't let an untouched claim go.
- **U16**, new: the formatting-only test mirrored in Commit 4 covered a behavior no row named.
- **I1.** The whole burst lands before the timer fires, so a debounce would pass too.

### Pure logic

`versionsRevisedBy`, `toSnapshot` / `withEvents`, `draftHoldsWork`, `inputsForDraft`,
`anchorsPlacedSince` — covered through the store, the contract, `entriesStore.test.ts` and
`anchors.test.ts`. Revisit in Pass 3.

## Coverage baseline

Taken 2026-09-29 at `a6ff417`, before Pass 1, to compare against after Pass 3 (the Pass 3 check).
Line coverage from `npm run test:coverage`, then `test:browser` and `test` each with `--coverage`;
Cypress isn't instrumented. Coverage can't show a lost assertion, only a lost path — the inventory
stays the record.

| File                                      | Combined | Browser Mode | Unit  |
| ----------------------------------------- | -------- | ------------ | ----- |
| `stores/draftsStore.ts`                   | 96.6%    | 75.1%        | 92.7% |
| `stores/entriesStore.ts`                  | 100%     | 70.5%        | 98.9% |
| `repositories/dexieDraftRepository.ts`    | 100%     | 100%         | —     |
| `repositories/inMemoryDraftRepository.ts` | 90.6%    | —            | 90.6% |
| `composables/useDraftSession.ts`          | 85.6%    | 85.6%        | —     |
| `views/DraftsView.vue`                    | 90.5%    | 92.1%        | —     |
| `views/EntryDetailView.vue`               | 94.0%    | 94.0%        | —     |
| `views/NewConnectionView.vue`             | 95.0%    | 95.0%        | —     |
| `components/EntryForm.vue`                | 93.3%    | 93.3%        | —     |
| `App.vue`                                 | 0%       | 0%           | —     |

**What only unit tests reach in `draftsStore.ts`** — what Pass 3 must keep a unit test for or
reach from the UI first:

- `flush`: an emptied draft deletes its row (U8); a conflicting save adopts what disk holds (U14);
  a failed write stays pending (I3)
- `sealDraft`: an empty entry refused (the UI disables Save, so a backstop); a refused seal keeps
  the draft and reschedules its flush (U11, I5)
- `releaseIfEmpty`: an untouched claim deleted (U10)
- `adoptChangesElsewhere` → `catchUpWithDisk` → `adoptStored`: tab return (U13)
- `addMark`: no UI yet, and outside the inventory

In `entriesStore.ts`, the draft paths only unit tests reach: `inputsForDraft`'s refusals (a
revision of a missing entry, one with no changes), `draftHoldsWork` for a non-empty draft that
isn't a revision, and `anchoredInputs` on a missing parent. Its other unit-only lines aren't draft
code.

**Reached by nothing:** `flushAll` (I2); `App.vue`, which wires flush-on-leave and tab return; and
`useDraftSession`'s watch on `drafts.elsewhere` — the notice and reload a tab shows when another
tab changed or sealed its draft. The store half of U13 and U14 is unit-tested; the half the user
sees is in no test.

## Passes

Each pass covers both runners and records its lessons in TESTING.md as they land, not at the end.
Passes 1–4 are Claude's, to bring the tests toward the vision before the user's own review.

### Pass 1 — standards

Grouped into proposed commits (the user may let more build up between them).

**Commit 1 — types and fixture**

- [x] Type storage handles in specs as the interfaces (`DraftRepository`, `EntryRepository`), and
      the `freshXRepository()` return types in `realRepositories.ts` with them.
- [x] Settle the draft fixture (D1). First: 55 call sites, so later items are written in its shape.

**Commit 2 — small cleanups**

- [x] `DraftsView.browser.test.ts` "resumes an unsealed session…": its comment says sealing writes
      the entry before deleting the draft, but `DexieDraftRepository.seal` is one transaction with
      the delete first. Fix the comment and drop the second `vi.waitFor` it justifies.
- [x] Assert the unreadable-draft alert exactly in both runners (Vitest uses the partial
      `toHaveTextContent`, Cypress the exact `have.text`).
- [x] Drop one-line mount wrappers (`mountDrafts`, `mountForm`); `mountDetail` earns its place.
      `mountNewConnection` stays too: it hides the route setup, as `mountDetail` does.
- [x] Seed with one `cy.then(async …)` yielding what the test uses — the `seed` precedent in
      `EntryDetailView.cy.ts` — in place of `NewConnectionView.cy.ts`'s nested pyramids.

**Commit 3 — retrying and meaningful assertions**

- [x] Make assertions retry (TESTING.md, "Layers"): a UI assertion first; a repository read only
      after one waiting on the same write, or after the session let go has flushed (D3). Known
      cases: the hand-rolled `waitForSavedDraft` poll in `NewConnectionView.cy.ts`; the unretried
      reads right after a click or unmount in `EntryForm.cy.ts` ("holds a session as a draft…") and
      `EntryDetailView.cy.ts` ("keeps a related entry in progress…").
- [x] Give absence assertions a baseline (TESTING.md, Don'ts) — "leaves no draft behind for a
      composer that was only opened" proves nothing in either runner: `EntryForm.cy.ts` never
      unmounts and reads before the flush timer; `EntryForm.browser.test.ts` unmounts, but its
      `vi.waitFor` passes before `abandonDraft` has flushed. A spied `abandonDraft` resolving marks
      the moment — it awaits the flush.
- [x] Replace `.closest('.rounded-lg')` in `EntryDetailView.cy.ts` ("shows the parent's own title…")
      with a semantic query. May need a labelled group in the source; say so before changing it,
      and call it out in the commit message. Done in both runners: `RelatedEntryComposer`'s two
      halves are now regions named by their headings.
- [x] Found on the way: "holds a session as a draft…" never checked that typing kept a draft, and
      its "not in the timeline yet" absence had no baseline. It now waits for the draft to reach
      disk first, in both runners.

**Commit 4 — runner parity**

- [x] Mirror the four Browser-only EDV tests into Cypress. The other tab there is a second Pinia over
      the same database (`setActivePinia(createPinia())`); try the same under `cy.mount`. It works
      as-is. The Browser "already in progress" test now waits on `abandonDraft` too (D3), not a poll.

**Commit 5 — inventory** (last, since the commits above change what specs assert)

- [x] Verify the inventory above against what each spec actually asserts.

### Pass 2 — fill component gaps

Grouped into proposed commits, as in Pass 1.

**Commit 1 — tests that couldn't fail**

- [x] U2 strengthened, done early: its disabled→enabled flip only re-proved `DocumentEditor`'s
      "reports nothing when only its editability changes", and passed without it; it now mounts
      and unmounts.
- [x] Look for more tests like the old U2: a parent spec re-driving a child's behavior, or a test
      still green with the fix it names reverted. Found:
  - EDV "offers the draft another tab has only just opened…" flushed the other tab itself, so it
    stayed green with `beginDraft`'s claim write removed (checked in both runners). It now waits
    on the write beginning starts, through a spy on the repository's `save`.
  - EDV "will not save a related entry that says nothing" read for a child nothing could have
    written; NewConnectionView "will not add a connection with no content" discarded to settle a
    write that never happens, since a connection claims nothing. Both dropped, in both runners.
  - Cypress still read the repository straight after a click in five places (EntryForm ×2,
    NewConnectionView ×2, DraftsView "reopens…"). Each now waits on the composer emptying or
    closing, checked by delaying `sealDraft` 500ms. A disabled editor shows its title as text, so
    "no Title textbox" passes the moment a save starts; the body textbox is the one to wait on.
  - Outside drafts, for a later pass: EDV's anchor-warning tests walk `changesInside`'s edge cases
    (moved, touching either edge, same-length paste) through the page. `anchorWarnings.test.ts`
    already tables them, and `affectedAnchorIds` is `DocumentEditor`'s, whose spec has no test of
    it. "stays quiet when a revision only moves an anchor" also checks its absence with no baseline.

**Commit 2 — DraftsView gaps**

- [x] U4: one test lists all four kinds out of seeded order, each row's label, time and preview. It
      replaces "names what each draft is attached to…", which checked one label.
- [x] U5: the resume test seeds a date, sees it in the form, and saves it; U6's entry count joined
      its Cypress half while there.
- [x] U7 for a listed draft while another is open; U11 for a revision, seeded on a version since
      replaced. The anchor-mode wording of the stale notice is left to the store.

**Commit 3 — composer gaps**

- [x] U3 and U8 in EntryForm; U10 and U16's refusal in EDV.

**Later commits**

- [ ] Close the runner gap the inventory check found: U7's Discard reaching disk in the composers,
      in Cypress. Decide whether U7's Browser waits are assertions and say so.
- [ ] Spike U13, U14 and I2 at component level. `DraftsView` doesn't listen for tab return; `App.vue`
      does. Try mounting `App` at `/drafts`, a second Pinia as the other tab, and a dispatched
      `focus` / `visibilitychange` / `pagehide`. Record the outcome in D4 either way.

### Pass 3 — prune unit tests

- [ ] Map each `draftsStore.test.ts` case to an inventory row; delete those whose row a component
      spec now covers; regroup the rest by durability concern. The weak U2 case goes, and I1
      gains a case that tells a throttle from a debounce.
- [ ] Trace internals (a no-steps change skipped, an anchor op in the parent stream): move to
      traceRecorder tests if they aren't there already, or drop.
- [ ] The same exercise for the draft cases in `entriesStore.test.ts`.
- [ ] `npm run test:coverage` as a check that no inventory row lost its test — not as a target.

### Pass 4 — contract and the Dexie file

- [ ] A conflict on the **parent** log.
- [ ] A save with no new events never conflicts — the title-only gap AUTHORING.md documents — stated
      as intended.
- [ ] The `list` tie-break on equal `updated_at`, and a multi-input seal returning `inputs` order.
- [ ] A refused seal leaves the draft exactly as it was, not only the same event count.
- [ ] `dexieDraftRepository.browser.test.ts`: fold its own `freshStorage` into
      `realRepositories.ts` or register it for cleanup; the persistence test leaks its database when
      an assertion fails.
- [ ] Remove `InMemoryDraftRepository.clear()`, unused.

### Pass 5 — the user's review

Cypress first, then Browser Mode, then unit. Final lessons into TESTING.md.

### Later — a real E2E layer

Pages in one Playwright browser context share IndexedDB: true two-tab, reload and `pagehide` tests
for U13, U14 and I2. Cypress runs inside a single tab and has historically not supported several;
check its current state when this starts. Several tools side by side is a plus for a portfolio
piece, not a liability.

## Decisions

Open:

- **D4 — multi-tab at component level or E2E.** Decided by the Pass 2 spike.

Decided:

- **D2 — fake steps.** Fixtures may record `{ stepType: 'replace' }` / `{ n: 1 }` where nothing
  replays them; tests moved up to component level get real steps from the editor. Revisit when the
  history view replays traces.
- **D3 — waiting on a write no UI shows.** Every such case is a session let go (an unmount, a
  change of entry), and `drafts.abandonDraft` resolves only once that session's flush has landed.
  Spy on it after mounting, wait for its promise, then read the repository plainly — in both
  runners, and for absence as well as presence. No retrying-read helper unless a case comes up
  that isn't a let-go; one would be named for the repository, not the database.
- **D5 — the sealed trace in component specs.** Assert only that one exists, through the
  repository, as `EntryForm.cy.ts` does; its details stay in unit tests.

- **D1 — fixture shape.** `makeDraft(sessionId, { entry, kind, updatedAt })`: the id stays first,
  the rest named, so no call passes placeholders to reach a later argument. A
  `relatedTo(parent, since)` builder derives a related draft's `kind`, `parent_id` and `parent`
  from the parent's `id` and `content`; `since` carries anchor marks and their events, and a plain
  `{ id, content }` stands in for a parent that isn't stored. It replaced `parentDocument`. A
  `seedDraft(drafts, draft)` saves with nothing persisted, for component specs and store tests;
  the contract keeps `NOTHING_PERSISTED` explicit, since the persisted counts are what it tests.
- This plan lives here, checked in, until folded into TESTING.md.
- Component specs arrange through the repository interface, act and assert through the UI
  (TESTING.md, "Layers").
- Specs stay backend-agnostic, so a desktop shell with storage behind IPC changes
  `realRepositories.ts` alone.
- Cypress ↔ Browser Mode duplication stays. Unit ↔ component overlap is minimized.

## Runner comparison notes

A running list for the Vitest Browser Mode vs Cypress write-up.

- **Router.** `cy.mount` builds its router inside the command and never hands it back, so a spec
  can't inspect the route after navigating; Vitest builds its own with `createTestRouter()`.
- **Retrying.** `vi.waitFor` retries an async block, repository reads included; Cypress retries
  queries and `.should`, but not a `cy.then` callback. So to wait for a write no UI shows outside a
  let-go, Vitest retries the read, and Cypress aliases a spy on the repository method, waits on
  `should('have.been.called')`, then on the call's returned promise.
- **Spies.** `vi.spyOn` and `cy.spy` both work on a Pinia store's actions after mounting; each
  exposes the call's returned promise (`mock.results[0].value` / `firstCall.returnValue`).
- **Seeding.** Inline `await` in Vitest; `cy.then(async …)` chains in Cypress.
- **Text matching.** `toHaveTextContent` is partial by default; `have.text` is exact. Vitest's exact
  form is a locator intersection, `getByRole('alert').and(getByText(text, { exact: true }))`,
  asserted visible — no regex. Should this go in TESTING.md's "Queries and selectors" later?
- **Keyboard.** Cypress's `.type()` simulates keys in JavaScript and has no `{tab}`; `cy.press()`
  sends a native key through the browser, Tab included. Vitest's `userEvent` goes native throughout.
- **Another tab.** A second Pinia over the same database works in both runners: set it active in a
  `cy.then` before `cy.mount`, which installs its own. Returning to the tab is a `focus` event on
  `window` (`cy.window()` in Cypress).
- **Component internals.** `cy.mount` yields the Vue Test Utils wrapper (`findComponent`, `props`,
  `setProps`); `vitest-browser-vue`'s `render` exposes none of that beyond `rerender` and `emitted`.

## Lessons log

What went into TESTING.md, and when.

- 2026-09-29 — "Layers": the arrange / act / assert rule, backend-agnostic specs, retrying reads and
  meaningful absence, when a unit test is warranted.
- 2026-09-29 — Don'ts: an absence needs a baseline that could have failed it. Philosophy: a parent
  that only configures a child asserts the prop, not the styling it produces.
- 2026-09-30 — "Layers": with no UI to wait on, spy on a call that already awaits the write rather
  than polling; a let-go session's `abandonDraft` is the example (D3).
