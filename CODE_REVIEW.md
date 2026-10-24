# Code review

Status: no review commits yet. A1 under way.

## Context

CHRONICLE_PLAN.md priority 1: understand and own the existing code, refactoring and simplifying as chances turn up. That's 60 source files (~8,900 lines) and ~10,900 lines of specs. A later priority waits only on review of the code it changes, so the order is set to unblock the next ones early. This file is deleted when the review is done, once anything that outlasts it has moved into the docs.

## Decisions

- **Outside in: screens, then composables, stores, model, repositories.** A caller shows what the code beneath it has to offer. A simplification found at a screen narrows an inner API before that API is reviewed, so the inner layer gets reviewed in its slimmed form. Rejected: following NewEntryView all the way down to Dexie first. That reaches the deepest layers before most of their callers have been read, so inner refactors get redone as other callers turn up.
- **Two tracks, split where the next priorities split.** Track A is the entry and draft path through every layer, which is what item 2 (connections folded) changes. Track B is the editor, which is what items 3 and 4 change. Track A comes first because it holds NewEntryView and unblocks item 2. Item 2 can then start before Track B, and Track B is still fresh when items 3 and 4 change it. Rejected: one pass with all screens first. It puts DocumentEditor (1,130 lines) second, and holds item 2 until both tracks are done.
- **A shared file is reviewed with the first screen that uses it.** EntryComposer and DraftElsewhereNotice go with NewEntryView, and later screens review only their wiring of them. Its own spec proves it (TESTING.md), so theirs prove only that wiring.
- **Connections: read, don't polish.** NewConnectionView and its specs are skipped, since item 2 removes them. Connection-specific code elsewhere in Track A (`target_id`, the `connection` relation type, `new_connection`) is read for understanding only, because item 2 replaces it. A bug found there still gets fixed.
- **Anchors are reviewed in full.** Items 3 and 4 (session tracking as a plugin, anchor wording as marked text) may be done during Track B, if reviewing that code makes the case for it.
- **Read the Browser Mode spec closely, and its Cypress mirror against it.** The pairs cover the same cases on purpose (TESTING.md), so the mirror is checked for drift (a case or assertion one has and the other lacks) rather than re-read from scratch. Shared test setup is reviewed in the first unit that runs it.
- **An improvement lands when it's ready, whatever layer it's in.** Pure simplification or reduction usually lands at once, even in a file no unit has reached yet. **Carried inward** holds what's better left: a change that needs the inner file understood first, or one that would swell the change it was found in.
- **What a unit produces.** Each refactor or fix is its own commit, green alone. A unit with nothing to change only moves Status on. Behavior questions go to PRODUCT.md, and engineering bigger than a review fix goes to CHRONICLE_PLAN.md.
- **`utils/format.ts`:** each function goes with the first unit that calls it. Whatever is left closes Track A.

## Units

Each unit lists its source with line counts, then the specs reviewed with it. **Verify:** each commit runs `npm run typecheck` and the unit specs covering what it changed, and each unit ends with the browser and Cypress specs listed. A change to a store, a repository, the editor schema or `src/testing/` runs the full component suites.

### Track A: the entry and draft path

1. **NewEntryView and the composer shell.** `NewEntryView.vue` 86, `EntryComposer.vue` 131, `EntryDetailsFields.vue` 157, `DraftElsewhereNotice.vue` 26, `useSealDraft.ts` 16, `router/draftQuery.ts` 28, plus the detail-field lines `types/entry.ts` gained in d344040. Shared setup: `src/testing/` `browserSetup`, `realRepositories`, `renderComponent`, `testRouter`, `draftFixtures`, `documents`, and `cypress/support/component.ts`. Specs: `NewEntryView` component and flow pairs, `EntryComposer` pair, `DraftElsewhereNotice` pair, `useSealDraft.test`.
2. **App shell.** `main.ts` 19, `App.vue` 22, `AppLayout.vue` 50, `router/index.ts` 54, `useLayoutWidth.ts` 29, `useStoragePersistence.ts` 61, `useTabVisibility.ts` 46. Specs: `App.flow` pair, `useStoragePersistence.test`.
3. **Timeline and Drafts.** `TimelineView.vue` 35, `EntryList.vue` 27, `EntryCard.vue` 78, `DraftsView.vue` 149. Specs: `EntryCard` pair, `DraftsView` component and flow pairs.
4. **EntryDetailView.** `EntryDetailView.vue` 579, `RelatedEntryComposer.vue` 73. Item 2 rewrites the breadcrumbs. Specs: `EntryDetailView` component pair (~800 lines each) and flow pair.
5. **Composables.** `useDraftSession.ts` 348, `useMedia.ts` 65. Specs: `useMedia` pair. `useDraftSession` has no spec of its own yet: see FILE_SPECS.md.
6. **draftsStore.** 664. Spec: `draftsStore.test`.
7. **entriesStore.** 365. Item 2 changes `inputsForDraft`. Spec: `entriesStore.test`.
8. **The entry model.** `reconstructEntryState.ts` 263, `entryValidation.ts` 84. Item 2 changes connection gathering and `assertValidRelation`. Specs: `reconstructEntryState.test` (601), `entryValidation.test`.
9. **Repository interfaces and in-memory twins.** `entryRepository` 48, `draftRepository` 54, `markSetRepository` 11, `mediaRepository` 40, in-memory entry 138, draft 88, mark set 30, media 35. Specs: the four `.contract.ts` (835 together), `inMemory*.test`.
10. **Persistent adapters and the composition root.** `chronicleDatabase.ts` 85, `dexieEntryRepository` 157, `dexieDraftRepository` 133, `dexieMarkSetRepository` 37, `opfsMediaRepository` 87, `repositories/index.ts` 48. Specs: `dexie*.browser.test`, `opfsMediaRepository.browser.test`.

Item 2 can start here.

### Track B: the editor

1. **DocumentEditor.** `DocumentEditor.vue` 1,130, `AnchorMenu.vue` 110. Likely more than one sitting. Shared setup: `anchorFixtures`, `selectTextRange`. Specs: `DocumentEditor` pair (763 and 866).
2. **Schema and anchor commands.** `anchorCommands.ts` 647, `AnchorInsertView.vue` 232, `extensions.ts` (re-read beside the commands). No specs of their own: DocumentEditor's cover them.
3. **The document and anchors.** `entryDocument.ts` 235, `anchors.ts` 291, `anchorWarnings.ts` 32. Specs: `entryDocument.test`, `anchors.test`, `anchorWarnings.test`.
4. **The trace's read side.** `marks.ts` 173, `replay.ts` 73, `markFrames.ts` 226, `markSetsStore.ts` 56, `types/markSet.ts` 42, `documentDiff.ts` 163, with `traceRecorder.ts` for context. No screen uses these yet; they serve the history view (item 7), and `documentDiff` waits on a revision's diff (CHRONICLE_PLAN.md). Specs: `marks`, `replay`, `markFrames`, `markSetsStore`, `documentDiff` tests.

Items 3 and 4 can start after B1–B3, or within them. Item 4 also touches `markFrames.ts`'s two anchor-node checks, and items 6–7 wait on B4.

## Carried inward

Found in one unit and left for the unit that reviews the file.

- **A6:** NewEntryView's conflict flow checks that disk keeps the other tab's version, but has never been seen failing. Break `flush`'s `DraftConflictError` branch while reviewing it. `draftsStore.test.ts` has no test of that branch, so the flow is its only proof: add one to the store's spec, then cut the flow to its disk check and one UI wait.
- **A10:** `DexieEntryRepository`, `DexieMarkSetRepository` and `OpfsMediaRepository` each carry a test-only `dispose()`, against TESTING.md's "source carries no entry points of its own for tests". Their specs can build through `realRepositories.ts`'s `fresh*Repository()` and leave cleanup to the global `afterEach`, as `dexieDraftRepository.browser.test.ts` already does and TESTING.md ("Swap the repository") already says. OPFS also needs `realRepositories.ts` to remove a directory by name, as `Dexie.delete(name)` does for a database, which its persistence test uses too. Then all three `dispose()` methods go. This changes shared test setup, so it runs the full browser suite.
- **B4:** `AuthoringChange` makes `ChangeSignals` optional, but its one app caller passes them all. The looseness serves `traceRecorder.test.ts`, whose calls pass only the signal each case is about. Make them required, with a fixture in that spec, as `DraftChange` did (TESTING.md, Don'ts). The case against: the recorder stores signals sparsely, so "a missing signal reads as unset" may be the model, not a test convenience.
- **B4:** `buildFrames`'s `check` parameter exists only so a test can fail it. Proposed: keep it, as the smallest way to reach a build-time check that no real input easily trips. Confirm when reading `markFrames.ts`.

## Toward later plans

Work the review turned up that is bigger than a review fix. Rough notes, kept as they evolve; each becomes a plan when its turn comes.

- **Every file with a spec of its own (from A1):** planned in FILE_SPECS.md.

## Manual check

At the end of each track, in the running app, behavior should be unchanged from before the review, apart from any planned item done along the way.

- **Track A:** write an entry and leave the page. Resume it from Drafts and save it. It shows on Timeline and on its own page. From that page, add a related entry and a revision, reloading between steps: nothing typed is lost.
- **Track B:** in a related entry, highlight one passage, strike another, add wording, attach an image, and save. The parent shows the marks and wording. A revision that disturbs an anchor warns.
