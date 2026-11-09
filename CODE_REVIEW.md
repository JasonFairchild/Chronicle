# Code review

Status: no review commits yet. A1 under way.

## Context

CHRONICLE_PLAN.md priority 1: understand and own the existing code, refactoring and simplifying as chances turn up. That's 60 source files (~8,900 lines) and ~10,900 lines of specs. The later priorities don't wait on it: review and planned work interleave, and code a priority changes before its unit comes up is reviewed in its new shape. This file is deleted when the review is done, once anything that outlasts it has moved into the docs.

## Decisions

- **Outside in: screens, then composables, stores, model, repositories.** A caller shows what the code beneath it has to offer. A simplification found at a screen narrows an inner API before that API is reviewed, so the inner layer gets reviewed in its slimmed form. Rejected: following NewEntryView all the way down to Dexie first. That reaches the deepest layers before most of their callers have been read, so inner refactors get redone as other callers turn up.
- **Two tracks.** Track A is the entry and draft path through every layer; Track B is the editor. Track A comes first because it holds NewEntryView, the path every entry takes. Rejected: one pass with all screens first, which mixes the editor's internals into the entry path.
- **A shared file is reviewed with the first screen that uses it.** EntryComposer and DraftElsewhereNotice go with NewEntryView, and later screens review only their wiring of them. Its own spec proves it (TESTING.md), so theirs prove only that wiring.
- **Connections: read, don't polish.** NewConnectionView and its specs are skipped, since item 3 removes them. Connection-specific code elsewhere in Track A (`target_id`, the `connection` relation type, `new_connection`) is read for understanding only, because item 3 replaces it. A bug found there still gets fixed.
- **Anchors are reviewed in full**: wording as marked text, and PRODUCT.md §5.4's lock.
- **Read the Browser Mode spec closely, and its Cypress mirror against it.** The pairs cover the same cases on purpose (TESTING.md), so the mirror is checked for drift (a case or assertion one has and the other lacks) rather than re-read from scratch. Shared test setup is reviewed in the first unit that runs it.
- **An improvement lands when it's ready, whatever layer it's in.** Pure simplification or reduction usually lands at once, even in a file no unit has reached yet. **Carried inward** holds what's better left: a change that needs the inner file understood first, or one that would swell the change it was found in.
- **What a unit produces.** Each refactor or fix is its own commit, green alone. A unit with nothing to change only moves Status on. Behavior questions go to PRODUCT.md, and engineering bigger than a review fix goes to CHRONICLE_PLAN.md.
- **`utils/format.ts`:** each function goes with the first unit that calls it. Whatever is left closes Track A.

## Units

Each unit lists its source, then the specs reviewed with it. **Verify:** each commit runs `npm run typecheck` and the unit specs covering what it changed, and each unit ends with the browser and Cypress specs listed. A change to a store, a repository, the editor schema or `src/testing/` runs the full component suites.

### First, when the review is next picked up: test data across the specs

Consider one pass over every spec against TESTING.md's data rules, before going on with the units: data shared between tests becomes each test's own, and a named value only one assertion reads becomes literals. Start with the `EntryDetailView` component pair, whose `PARENT_TEXT` about 20 tests share. Verify: the full component suites.

### Track A: the entry and draft path

1. **NewEntryView and the composer shell.** `NewEntryView.vue`, `EntryComposer.vue`, `EntryDetailsFields.vue`, `DraftElsewhereNotice.vue`, `useSealDraft.ts`, `router/draftQuery.ts`, plus the detail-field lines `types/entry.ts` gained in d344040. Shared setup: `src/testing/` `browserSetup`, `realRepositories`, `renderComponent`, `testRouter`, `draftFixtures`, `documents`, and `cypress/support/component.ts`. Specs: `NewEntryView` component and flow pairs, `EntryComposer` pair, `DraftElsewhereNotice` pair, `useSealDraft.test`.
2. **App shell.** `main.ts`, `App.vue`, `AppLayout.vue`, `router/index.ts`, `useLayoutWidth.ts`, `useStoragePersistence.ts`, `useTabLifecycle.ts`. Specs: `App.flow` pair, `useStoragePersistence.test`.
3. **Timeline and Drafts.** `TimelineView.vue`, `EntryList.vue`, `EntryCard.vue`, `DraftsView.vue`. Specs: `EntryCard` pair, `DraftsView` component and flow pairs.
4. **EntryDetailView.** `EntryDetailView.vue`, `RelatedEntryComposer.vue`. Item 3 rewrites the breadcrumbs. Specs: `EntryDetailView` component and flow pairs.
5. **Composables.** `useDraftSession.ts`, `useMedia.ts`. Specs: `useMedia` pair. `useDraftSession` has no spec of its own yet: see FILE_SPECS.md.
6. **draftsStore.** Spec: `draftsStore.test`.
7. **entriesStore.** Item 3 changes `inputsForDraft`. Spec: `entriesStore.test`.
8. **The entry model.** `reconstructEntryState.ts`, `entryValidation.ts`. Item 3 changes connection gathering and `assertValidRelation`. Specs: `reconstructEntryState.test`, `entryValidation.test`.
9. **Repository interfaces and in-memory twins.** `entryRepository`, `draftRepository`, `markSetRepository`, `mediaRepository`, and the in-memory entry, draft, mark set and media adapters. Specs: the four `.contract.ts`, `inMemory*.test`.
10. **Persistent adapters and the composition root.** `chronicleDatabase.ts`, `dexieEntryRepository`, `dexieDraftRepository`, `dexieMarkSetRepository`, `opfsMediaRepository`, `repositories/index.ts`. Specs: `dexie*.browser.test`, `opfsMediaRepository.browser.test`.

### Track B: the editor

1. **DocumentEditor.** `DocumentEditor.vue`, `EditorToolbar.vue`, `AnchorMenu.vue`, `useRovingTabindex.ts`. Likely more than one sitting. Shared setup: `anchorFixtures`, `selectTextRange`. Specs: the `DocumentEditor` pair, and the `EditorToolbar` and `AnchorMenu` pairs.
2. **Schema and anchor commands.** `anchorCommands.ts`, `anchorIndex.ts`, `anchorGuard.ts`, `extensions.ts`, `changeSignals.ts`. Specs: `anchorIndex.test`, `anchorGuard.test`, `changeSignals.test`; DocumentEditor's cover the rest. Item 2 (one document model) moves the schema out of `extensions.ts`.
3. **The document and anchors.** `entryDocument.ts`, `anchors.ts`. Specs: `entryDocument.test`, `anchors.test`. Item 2 moves most of both onto nodes.
4. **The trace's read side.** `marks.ts`, `replay.ts`, `markFrames.ts`, `markSetsStore.ts`, `types/markSet.ts`, `documentDiff.ts`, with `traceRecorder.ts` for context. No screen uses these yet; they serve the history view (item 5), and `documentDiff` waits on a revision's diff (CHRONICLE_PLAN.md). Specs: `marks`, `replay`, `markFrames`, `markSetsStore`, `documentDiff` tests.

### Last: condense comments across the repo

Once both tracks are done, one pass over every source file, cutting length first (CLAUDE.md: the non-obvious why, once, in proportion to its code).

- Heaviest at planning: `utils/format.ts` 39%, `anchorCommands.ts` 35%, `useDraftSession` 30%, `entriesStore` 24%.
- Known repeat: "a property of the editor, not a rule the UI is trusted to follow" appears three times; ENTRY_MODEL.md says it once.
- Compare each file's comments against the docs in CLAUDE.md's table. Behavior and model rules live in the docs, and a comment doesn't restate them; anything a comment holds that belongs in a doc moves there.
- Cite a doc once per file, at its header, when several comments lean on it. Cite a section beside the code only for one specific behavior a reader there needs.
- Report comment lines per file, before and after, counting `//`, `/* */` and `<!-- -->` lines.
- Verify: typecheck, lint.

## Carried inward

Found in one unit and left for the unit that reviews the file.

- **B1:** two EditorToolbar cases were cut from its pair as borderline, to decide when reviewing it: an empty Link address removes the link under the caret (`applyLink`'s `unsetLink` branch), and a pointerdown outside closes More (`handleDocumentPointerDown`). Both go untested until then.
- **B4:** `AuthoringChange` makes `ChangeSignals` optional, but its one app caller passes them all. The looseness serves `traceRecorder.test.ts`, whose calls pass only the signal each case is about. Make them required, with a fixture in that spec, as `DraftChange` did (TESTING.md, Don'ts). The case against: the recorder stores signals sparsely, so "a missing signal reads as unset" may be the model, not a test convenience.
- **B4:** `buildFrames`'s `check` parameter exists only so a test can fail it. Proposed: keep it, as the smallest way to reach a build-time check that no real input easily trips. Confirm when reading `markFrames.ts`.

## Toward later plans

Work the review turned up that is bigger than a review fix. Rough notes, kept as they evolve; each becomes a plan when its turn comes.

- **Every file with a spec of its own (from A1):** planned in FILE_SPECS.md.

## Manual check

At the end of each track, in the running app, behavior should be unchanged from before the review, apart from any planned item done along the way.

- **Track A:** write an entry and leave the page. Resume it from Drafts and save it. It shows on Timeline and on its own page. From that page, add a related entry and a revision, reloading between steps: nothing typed is lost.
- **Track B:** in a related entry, highlight one passage, strike another, add wording, attach an image, and save. The parent shows the marks and wording. A revision can't change the text under an anchor.
