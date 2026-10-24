# Every file with a spec of its own

Status: commit 1 written, not yet committed. Coverage baseline recorded under commit 17.

## Context

TESTING.md says each source file has a spec of its own, proving that file's code at its seams, and each caller proves only its wiring of it. Code review (CODE_REVIEW.md, A1) found where that wasn't so. NewEntryView.cy had become the spec for `useDraftSession` and `useSealDraft`, because "a shell is proven once through its simplest owner" let anything shared ride on its first caller. Most of its tests needed a second Pinia, App's focus handling or another tab to reach code that wasn't NewEntryView's.

This plan gives every `src` file a spec of its own, merges it into its caller, or notes why it has neither. For each spec there are two steps: write it, then cut whatever it now makes redundant, wherever that is. Flows that repeat a screen's own spec are cut too. A coverage pass comes last.

It is independent of the review units: each commit stands alone, so a file's spec can be written in its review unit or on its own. This file is deleted when the last commit lands, once anything that outlasts it has moved into the docs (commit 18).

## Decisions

- **One file per commit**, with its spec and its cuts together. `useDraftSession` is the exception: its spec is one commit and the cuts across four owners' specs are a second, because the second is big enough to review on its own.
- **Order by value, least last.**
  - First, `useDraftSession`: its behavior is spread over four owners and needs a second Pinia to reach.
  - Then the flow cuts, since they're duplicates already.
  - Then files with real invariants nothing proves today: the read-only related draft, an emptied detail becoming `null`, the draft helpers, the layout width.
  - Last, files whose behavior contracts or flows already reach in passing: `compareMarkSets`, the media MIME helpers, the route table.
- **Before cutting a test, check coverage for lines only it reached** (TESTING.md, "Layers"). Run `npm run test:coverage` before the cut, note the source file's uncovered lines, and compare after. Coverage is Vitest only, so a Cypress mirror is cut together with its Browser Mode twin.
- **Cutting means proving wiring, not deleting the scenario.**
  - An owner test that is part session behavior and part wiring is shrunk to the wiring: which session method a control calls, what the owner renders from the session, where it navigates, and the order its own handler does things in.
  - A test is deleted outright only when what remains is already owned elsewhere.
  - A UI check placed before a repository read is a wait, not a duplicate, and stays (TESTING.md, "A repository read doesn't retry").
- **Editor files wait for Track B.** `extensions.ts`, `anchorCommands.ts`, `AnchorInsertView.vue` and `AnchorMenu.vue` get their specs as Track B reviews them, once CHRONICLE_PLAN.md items 3–4 are decided. Item 4 would replace the AnchorInsert node and its view. DocumentEditor's specs stay as they are until then. What was learned goes into Track B unit 2 in CODE_REVIEW.md (commit 18):
  - Browser project alone, with a bare TipTap `Editor`.
  - A headless node `Editor` (`element: null`) never emits `create`, so `AnchorMode.onCreate` wouldn't seed `sealedAnchorIds`.
  - `anchorSpans`, `anchorMarkRanges` and `mapAnchorSpans` are pure and could run in node over `replayDocument`.
  - Unproven today: the guard actually rejecting an edit, `excludes: ''`, `Mod-Alt-s`, the live region, AnchorMenu's roving tabindex, and the box committing on focus-out.
  - The ED flows click Accept wording in Browser Mode but press Enter in Cypress, which is drift.
  - Rejected for now: a third Vitest project on happy-dom/jsdom. The browser project already runs these for real.
- **App.vue: App.flow is its spec.** `useTabVisibility` gets its own spec for the event mapping. App.flow keeps one test per direction as App's wiring.
- **`useTabVisibility`: browser-only spec with a host.** Its point is real `pagehide`/`visibilitychange`/`focus` events listened for in `onMounted`, which need a mounted instance and a browser.
  - The spec mounts, through `renderComponent`, a host component that only calls the composable.
  - There's no Cypress mirror, since nothing user-facing is mounted. This matches the Dexie and OPFS adapters.
  - TESTING.md says otherwise today (non-components get a node spec; every mounting `.browser.test.ts` has a mirror; no `defineComponent` in component tests). So commit 9 amends it then, not later.
  - Proposed line, to decide at that commit: _"A composable whose point is a browser event in a lifecycle hook is proven in the browser project alone, through a host component that only calls it; the host is scaffolding, not the subject, so it has no Cypress mirror."_
- **`useLayoutWidth`: merge `provideLayoutWidth` into AppLayout, its only caller.**
  - AppLayout provides through an exported `layoutWidthKey`. That's an app use, not a test entry point.
  - `useLayoutWidth`'s fallback ref goes. It exists only so a view mounted bare in a test can call it (TESTING.md, Don'ts), and AppLayout always provides. With no provider it throws, which only a wiring mistake reaches. EntryDetailView's mount helpers provide a width instead.
  - `useLayoutWidth` gets a node spec under `app.runWithContext()` with `app.provide(layoutWidthKey, …)`. Vue 3.5's `provide()` does nothing outside a component and only warns; `inject()` works under `runWithContext`.
  - EntryDetailView raising and lowering the width (`EntryDetailView.vue:279–289`) is that view's own code and is untested, so it gains a test in its pair.
  - Rejected: a browser host spec. The file has no lifecycle hooks and no browser API, and the spec would prove the plumbing while missing the view's behavior.
- **`useDraftSession` needs no host.**
  - It injects nothing and has no lifecycle hooks, and Pinia's `useStore` falls back to the active Pinia. Its `DocumentEditor` import is type-only.
  - Its watcher runs in an `effectScope`, stopped after each test. The watcher fires on the pre-flush queue, so tests `await nextTick()` after `adoptChangesElsewhere()`.
  - After driving `anotherTab()`, switch back to the first tab's Pinia, since `sealDraft` calls `useEntriesStore()` after an await.
- **EntryList and TimelineView each get a small pair. EntryList's `emptyMessage` prop is dropped:**
  - It came with the generated first commit (459b548), and nothing has ever passed it.
  - EntryDetailView renders its own cards rather than an EntryList.
  - PRODUCT.md §5.6 has the timeline becoming visual, not a list.
  - Its plausible use is "nothing matches these filters", which can come with the filters (CLAUDE.md, "No backward compatibility").
- **No spec, with the reason noted in TESTING.md:**
  - `main.ts`: bootstrap, outside coverage.
  - `chronicleDatabase.ts`: each index is proven by the adapter query that needs it; a missing one throws.
  - `repositories/index.ts`: every spec runs through its setters.
  - The type-only interface files (`entry`/`draft`/`markSetRepository.ts`): their contract.
  - `src/testing/`, `*.d.ts`, `main.css`: not app code.
  - `App.vue`: App.flow.
  - The four editor files: until Track B.
- **NewConnectionView is out of scope.** Item 2 removes it. Its specs aren't trimmed. New specs include `new_connection` only where a function switches on kind, for item 2 to delete.

## Mechanics found so far

These move to the write-tests skill's `mechanics.md` in commit 18, wherever it doesn't already say them.

- A composable calling `useRouter()` runs in node under `app.runWithContext()`, with a hand-built router (`useSealDraft.test.ts`).
- `src/router/index.ts` can't load in node: `createWebHistory` runs at import and reads `window`. So `createTestRouter()` is browser-only.
- A fire-and-forget `router.push` is asserted with a spy on `push`, not on the route, which hasn't moved yet when the caller resolves.
- `router.resolve()` doesn't follow redirects; `await router.push()` does.

## Applies beyond its file

Changes one commit made to how a test is written that other specs should get too. Each entry gives the change, the commit it came from, and the specs a grep found the same pattern in. A later commit that reworks one of those specs applies the change there and takes the spec off the list; commit 16 applies the rest.

- None yet.

## Commits

Every commit: `npm run typecheck`, each new test seen failing first (break the line under test, run, restore), and the specs named. Browser specs run with `npm run test:browser -- <path>`, Cypress with `npm run cy:run -- --spec <path>`.

When a commit changes how a test is written, not just what it proves, grep the other specs for the same pattern and add what turns up to "Applies beyond its file", without asking.

1. **Remove the dead in-memory singleton.** `inMemoryEntryRepository.ts:137` exports `entryRepository = new InMemoryEntryRepository()`, which nothing imports.
   - Verify: `npm run test -- src/repositories/inMemoryEntryRepository.test.ts`.

2. **`useDraftSession` spec**, `src/composables/useDraftSession.test.ts`, node. Setup follows `draftsStore.test.ts`:
   - `setActivePinia(createPinia())`, with in-memory entry and draft repositories through the composition root's setters.
   - `anotherTab()` is a second Pinia over the same repositories.
   - A same-moment conflict comes from `InMemoryDraftRepository.save` throwing `DraftConflictError`. Gone and quiet reloads come from the first tab's `adoptChangesElsewhere()`.
   - Tests:
     - begins with nothing written
     - resumes a draft with its words, title, details, and the parent's content, base and title
     - resolves null for a draft that's gone; rethrows any resume failure other than unreadable
     - shows a draft that can't be reopened read-only with its reason, and still discards it
     - marks a revision stale when its entry has moved on: read-only, with its reason
     - marks a related entry stale with `staleNotice`, still writable (asserted nowhere today)
     - save resolves null when nothing is open, a save is in flight, or the version is stale (and sets stale); it rethrows other failures and stays open, with `saving` false again
     - closes, with a notice, when another tab saved or discarded the draft
     - reloads another tab's version (`editorKey` changes), keeping this tab's text to copy, but only when it lost some
     - `canSave` is false for a title alone or blank words
     - details and parent changes are recorded, and nothing is recorded with no session open
     - abandon keeps what reached disk; reset clears everything for the next entry
   - Verify: the new spec.

3. **Cut the session's owners to their wiring.** Each candidate is coverage-checked first. Nothing is deleted outright. Shrink:
   - **NewEntryView "keeps what was written, and says why, when the discard fails":** the words are still there after a failed discard. That is `handleDiscard` beginning only once `discard` resolves. Drop the alert wording, which is EntryComposer's.
   - **NewEntryView "reopens the draft it links to…":** that `?draft=` is resumed; its words are enough. Its title and dates move to commit 2.
   - **NewEntryView "shows a linked draft that will not reopen…":** no fresh draft over a read-only one, and one begins once it's discarded. The read-only reason moves to commit 2.
   - **NewEntryView "offers a new entry once its draft is saved or discarded elsewhere":** the Start a new entry button, plus one check that the notice shows. This is the only proof the page mounts `DraftElsewhereNotice`, since commit 9 cuts App.flow's wording.
   - **EntryDetailView:**
     - "keeps a revision open… when its save fails" and "turns a revision read-only… once its save is refused": what `saveRevision` itself does on a failure and on null.
     - "opens a revision it was linked to read-only…": the link resumes into the revision composer.
     - "reopens the related-entry draft… on both halves".
     - "revises one detail…".
     - "refuses a revision that changes nothing…".
   - **EntryComposer "shows all of a draft that will not reopen…":** given a stub session (`reactive({...}) as DraftSession`, as `DraftElsewhereNotice`'s spec does) rather than a resumed unreadable draft.
   - The NewEntryView conflict flow stays: it reads disk (CODE_REVIEW.md, A6).
   - Verify: the unit spec, then the NewEntryView, EntryDetailView and EntryComposer browser and Cypress specs, component and flow.

4. **Cut flow assertions a screen's spec already owns.** Each one is checked first for whether a later read waits on it.
   - NewEntryView.flow Discard: the emptied Title and body (86–87). The deleted-row check stays.
   - NewEntryView.flow save, "details and all": the four detail-line strings (47–53) shrink to one line, or become a read of the stored details. This is the flow's end check, so it can't simply go.
   - EntryDetailView.flow "adds a related entry…": the About breadcrumb (38–41), unless it's the wait for the landing.
   - DraftsView.flow discard: "No drafts in progress." (46) becomes a `draftRepository` read, which no screen shows, waited on the `discardDraft` spy.
   - **Kept, after checking:**
     - EntryDetailView.flow "Version 2 of 2" (179, 200): the wait before `listRevisions`.
     - "frees the entry when the page is left…": the only end-to-end proof, and a cross-screen UI check.
   - Verify: `npm run test:browser -- .flow.` and `npm run cy:run -- --spec "src/**/*.flow.cy.ts"`.

5. **`RelatedEntryComposer` pair**, on a real session begun or resumed for `new_related` on a seeded entry.
   - Tests:
     - two regions, "This entry" and "The related entry"
     - in anchor mode, the instructions and optional-marking hint show, and the parent editor is described by them
     - read-only: the parent is display-only with its anchors, with no instructions or hint
     - a parent edit reaches `session.handleParentChange` (spy)
     - Add entry and Discard reach `onSave` and `onDiscard`
   - Closes TESTING.md's second Known gap; that bullet goes.
   - Cuts: EntryDetailView "shows the parent's own title in the anchor-mode composer" moves here, and the page keeps only that it opens the composer.
   - Verify: the new pair and the EntryDetailView pair.

6. **`EntryDetailsFields` pair.**
   - Tests:
     - each field shows its value
     - typing emits a whole new object with only that key changed (spy on `onUpdate:modelValue` in `attrs`)
     - an emptied or blank field becomes `null`
     - `readonly` keeps values legible and unchangeable
     - `disabled` disables every input
     - the groups are named by their legends
   - Cuts: none expected. Check EntryDetailView "revises one detail…" for an "others untouched" assertion it can drop.
   - Verify: the new pair and the EntryComposer pair.

7. **`types/draft.ts` spec**, `src/types/draft.test.ts`.
   - `versionsRevisedBy` as a table over the kinds.
   - `newDraftEntry` is empty.
   - `draftFieldsOf` drops `content` and `media_refs` and keeps the rest.
   - `toSnapshot` and `withEvents` strip and rejoin logs: both documents for `new_related`, the entry alone otherwise.
   - Cuts: none; the contracts prove adapters.
   - Verify: the new spec.

8. **`router/draftQuery.ts` spec**, `src/router/draftQuery.test.ts`.
   - `draftLocation` as a table over the kinds.
   - `useDraftToResume` under `app.runWithContext()` with a hand-built memory router, as `useSealDraft.test.ts` does: a string, absent, a repeated `?draft=` → null, and following a route change.
   - Cuts: DraftsView "lists drafts newest first…" keeps one Resume `href` of four, as wiring.
   - Verify: the new spec and the DraftsView pair.

9. **`useTabVisibility` spec**, `src/composables/useTabVisibility.browser.test.ts`, browser-only with a host. Amends TESTING.md as in Decisions.
   - Tests:
     - return fires on `focus` and on becoming visible, not on hiding
     - leave fires on `pagehide` and on hiding, not on showing
     - neither fires after unmount
   - `visibilityState` is shadowed by an own property, deleted after each test.
   - Cuts in App.flow, which keeps one test per direction:
     - "…once this tab is shown again" (72) duplicates the focus test at 47.
     - "…when the tab is hidden" (159) duplicates `pagehide` at 144.
     - The notice wording at 113–115 goes, since NewEntryView keeps the notice check.
     - The draft label at 141 is DraftsView's.
   - Verify: the new spec and the App.flow pair.

10. **`AppLayout` pair, plus `dismiss` in `useStoragePersistence`'s own spec.**
    - `useStoragePersistence.test.ts` gains: a dismissal hides the notice and is remembered across a reload (it reads the key at import). It's untested today, and AppLayout's spec mustn't be its only proof.
    - AppLayout's tests:
      - the brand and three nav links by `href`
      - the storage notice shown after a refusal, and gone on Dismiss
    - `dismissed` is module state read once at import. So the nav test runs first, a single test covers refusal then Dismiss, and an `afterEach` removes `chronicle:storage-notice-dismissed`.
    - `aria-current` is RouterLink's, and the width class is styling; neither is asserted.
    - Verify: both specs.

11. **`useLayoutWidth`: merge `provideLayoutWidth` into AppLayout, drop the fallback, then spec it.** The source change: AppLayout provides through an exported `layoutWidthKey`, and `useLayoutWidth` throws with no provider.
    - `src/composables/useLayoutWidth.test.ts`, node, under `app.runWithContext()`:
      - returns the ref provided under the key
      - throws with no provider
    - EntryDetailView's `mountDetail`, in both runners, provides a width ref through the mount's `global.provide`. The pair gains one test: that ref turns `'wide'` while the related composer is open, and back to `'normal'` after Discard and after unmount.
    - Verify: the new spec, and the AppLayout and EntryDetailView pairs.

12. **`EntryList` and `TimelineView` pairs, and drop `emptyMessage`.**
    - EntryList: the empty text, and a card per entry in the order given.
    - TimelineView:
      - lists root entries once mounted
      - says why a load failed, with `listRootEntries` stubbed to reject
    - The empty text is EntryList's, a child, so TimelineView doesn't assert it.
    - Source change: `loadRootEntries` rethrows, so `void store.loadRootEntries()` would leave an unhandled rejection that fails both runners. The call becomes `.catch(() => {})`, since `store.error` already says why, as DraftsView does (`DraftsView.vue:35–36`).
    - Verify: both pairs.

13. **`compareMarkSets` spec**, `src/types/markSet.test.ts`, mirroring `compareEntries` in `entry.test.ts`: by `created_at`, tied on `id`. The contract hits the tie only by chance.
    - Verify: the new spec.

14. **Media MIME helpers spec**, `src/repositories/mediaRepository.test.ts`.
    - Every known type round-trips through `extensionForMime` → id → `mimeForMediaId`.
    - An unknown type gives `bin`; an unknown extension gives `application/octet-stream`.
    - Verify: the new spec.

15. **Route table spec**, `src/router/index.browser.test.ts`, browser-only, since `createWebHistory` reads `window` at import. Uses `createTestRouter()`, and `await router.push(...)`, because `resolve()` doesn't follow redirects:
    - `/` lands on `new-entry`
    - `/entries/new` is `new-entry`, not an entry called "new"
    - `/entries/:id` passes `id` as a prop
    - Least value: every flow already leans on all three.
    - Verify: the new spec.

16. **Apply what's left under "Applies beyond its file."** It comes before the coverage pass, so coverage measures the finished specs.
    - Verify: each spec it touched, in the runners that spec runs in.

17. **Coverage pass.** `npm run test:coverage` over the whole suite. Any line the cuts left unreached either gets a test in the spec of the file it belongs to, or is judged a gap that TESTING.md's "Coverage" says doesn't earn one. Then the full component suites once (`npm run test:browser`, `npm run cy:run`), since the cuts touched shared views.
    - Compare with the baseline taken before commit 1 (2026-10-23; 39 files, 431 tests):

      |              | Stmts             | Branch            | Funcs          | Lines             |
      | ------------ | ----------------- | ----------------- | -------------- | ----------------- |
      | All files    | 92.34 (2076/2248) | 85.59 (1206/1409) | 93.2 (590/633) | 95.28 (1858/1950) |
      | components   | 81.78             | 79.08             | 76.28          | 84.67             |
      | composables  | 95.16             | 92.63             | 97.82          | 97.23             |
      | domain       | 98.21             | 95.63             | 100            | 100               |
      | editor       | 86.15             | 74                | 92.79          | 92.68             |
      | repositories | 97.18             | 84.78             | 96.29          | 98.27             |
      | stores       | 95.27             | 87.76             | 92.85          | 98.09             |
      | utils        | 100               | 96.96             | 100            | 100               |
      | views        | 93                | 85.77             | 97.56          | 95.54             |

18. **Docs.**
    - TESTING.md gains a short "Files without a spec of their own" list, with the reasons above.
    - CODE_REVIEW.md:
      - Each unit's "Specs:" list gains the new specs (Track A units 1–5; Track B unit 4 for `markSet.test`).
      - Track B unit 2's "No specs of their own: DocumentEditor's cover them" becomes: each gets its own spec in that unit, and DocumentEditor's are cut to wiring, with the editor notes from Decisions.
      - Its pointers to this file go.
    - "Mechanics found so far" moves to the write-tests skill's `mechanics.md`.
    - This file is deleted.
    - Verify: none (docs).

## Manual check

In the running app (`npm run dev`), behavior is unchanged:

- Timeline with no entries says "No entries yet. Write one from New entry."; after one is saved, it shows its card.
- Opening a related entry widens the page to two columns, and leaving it narrows it again.
- A draft left on New entry resumes from Drafts.
