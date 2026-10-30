# Chronicle Testing Guidelines

How tests are written here and why. These apply to component and flow specs in **both** runners: anything said about Cypress applies to Vitest Browser Mode unless noted, since the two run deliberately duplicated specs for tool comparison.

## Where tests live

| Suffix | Runner | Environment | What belongs here |
| --- | --- | --- | --- |
| `*.test.ts` | Vitest, `unit` | node | Source that isn't a component: domain, editor, stores, composables, repositories, types, utils |
| `*.browser.test.ts` | Vitest, `browser` | real Chromium | Components, and anything needing real browser APIs |
| `*.cy.ts` | Cypress | real browser | Components, mirroring the `.browser.test.ts` spec |
| `*.flow.browser.test.ts` | Vitest, `browser` | real Chromium | Flows: the app from a route, down to what's stored |
| `*.flow.cy.ts` | Cypress | real browser | Flows, mirroring the `.flow.browser.test.ts` spec |
| `*.contract.ts` | imported, never run | either | A shared suite run against multiple implementations |

**A flow spec sits beside the view its route starts on**, whatever screens it passes through: a flow from `/entries/new` lives in `NewEntryView.flow.cy.ts`. `App`'s own flows — tab return, flushing on leave — sit beside `App.vue`. The runners' existing globs already match the `.flow.` names; to run only flows, pass `--spec "src/**/*.flow.cy.ts"` to Cypress or `.flow.` to Vitest as a filter.

**Duplicate specs are intentional.** `EntryCard.browser.test.ts` and `EntryCard.cy.ts` cover the same cases on purpose, to compare the two runners, and flow specs pair the same way. Don't consolidate them.

**Each file has a spec of its own, in the runner for its kind.** A component gets a pair: a `.browser.test.ts` and its `.cy.ts` mirror. Anything else gets a node `*.test.ts`, even a composable that injects: `useRouter()` resolves under `app.runWithContext()`. The exception is source needing a real browser API, such as the Dexie and OPFS adapters, proven in the Vitest browser project alone, with nothing to mount for Cypress. Flows are always pairs.

**Cypress should keep up with Vitest Browser Mode.** Every `.browser.test.ts` that mounts something has a `.cy.ts` mirror, the same as any other duplicated pair.

**Contract suites are for interfaces with more than one implementation.** Each of the four repositories exports one: `entryRepository.contract.ts`, `draftRepository.contract.ts` and `markSetRepository.contract.ts` (each in-memory and Dexie), and `mediaRepository.contract.ts` (in-memory and OPFS). That is what makes "swap the storage backend by changing one line" provable rather than asserted. They are named `.contract.ts` precisely so no runner picks them up directly.

The persistent halves run in the browser project only — Dexie needs real IndexedDB and OPFS needs a real origin private file system, and neither has anything to fall back to in node.

## Philosophy

- **Test from the user's perspective where there is one.** Simulate real interaction and assert what a user can see. Where a file's output isn't on screen — a call it makes on another file, what a lifecycle hook does — assert that call directly with a spy, rather than hunting for an echo of it a user might notice. Don't assert internal state, private methods, or DOM structure nobody interacts with.
- **Don't test child components.** They get their own specs, or are treated as third party. Selecting or interacting with a child's elements as a means to an end is fine; asserting on behavior that belongs to the child is not. Where a parent only configures a child and the one visible result is styling — a table's `striped` prop, say — assert the prop it passes (`findComponent(Table).props('striped')`), not the computed CSS; the child's spec already proves what the prop does.
- **Test what the file contains.** A spec proves the code in the file it's named after, at its seams: what it takes in, what it produces, what it calls on the files it uses. The real stack beneath is how a spec acts and observes, not what it's about. A file used by several others is proven in its own spec, and each user proves only its wiring of it. A file with nothing worth proving is a candidate to merge into its caller; a definitions file whose value is the point, such as the schema or the route table, tests that value.
- **One idea per test, at whatever size it takes.** Longer tests are fine when they represent one coherent idea, such as select a passage, strike it, propose wording, save, and see it rendered. A test can equally be as small as one line of its file: a spy on `abandonDraft` across an unmount is how a view proves its `onBeforeUnmount`.
- **Never mock what's in scope.** Everything a spec is about runs for real, watched with a spy where the screen can't show it. For a component spec, that is the component's own script, the children it renders, what it emits and where it navigates. The stores, composables and storage it runs on still run for real beneath it, unchecked: each has its own spec. Storage is seeded the way an intercept seeds a page, stubbed to fail when the failure is the point, and never read back. A spec may hand its file a stand-in for an input it reads only part of, such as a session holding just the fields the file reads.
- **Test the code the app runs.** A test goes through the path the app takes, never an API only tests call, so source carries no entry points of its own for tests. The composition root's setters are the one seam (see "Swap the repository").
- **Use a fail first approach.** Every new test should be proven to fail as expected before being made to pass. For already working code, it can be broken, tested then restored.

## Layers

Tests are one design, judged together rather than file by file. There are three levels — unit, component and flow. Every file's own spec is a unit or component spec, by its kind ("Where tests live"). One question places a test beyond those: **does it check what was stored, or reach another screen?** Yes makes it a flow spec. Overlap between levels is kept to what each needs, unlike the Cypress ↔ Browser Mode duplication, which is deliberate: a file's spec proves its own code, and a flow proves files working together, leaning on their specs for the details.

**Component specs are the screen alone.** They mount the component under test. Storage runs real and isolated beneath it, as for every spec (see "Swap the repository" below), but it's the backend, out of scope, and is handled the way a request intercept handles one:

- **Seed it** through the repository interface before mounting, with whatever the screen shows.
- **Fail it** by stubbing one repository method to reject, when what the screen shows for a failure is the point.
- **Never read it back.** Assert through the UI and the component's own outputs — what it emits, where it navigates. What reached storage is a flow's to check. If a spec needs storage to see a result, first ask whether the screen should show it.

The exception is a unit whose job is storage, such as `useMedia`, or `DocumentEditor` storing an attached image: what it stores is its output, so its spec reads it back.

A component spec owns everything its own code produces: every state its screen can show, how it responds — empty and error states, validation, what each control does there — and where it sends the writer next. It owns them even when a flow walks through them. A link is checked by its `href`, not followed: landing there is the destination's to prove.

**Flow specs are narrow end-to-end tests.** They mount `App` at a route and prove a path from the click down to what's stored, across as many screens as it takes. A flow walks one path per user goal and checks where it ends — the saved entry on its page, a draft kept when the page is left. What each screen does along the way, such as where it navigates, the flow leans on without asserting: it fails if that breaks, but the screen's own spec is where it's checked. Keep them independent of which backend is real:

- **Arrange through the repository interface, act through the UI, assert through the UI.** Read the repository only for what no screen can show: nothing left on disk, the original row untouched, a trace that has no view yet.
- **Type storage handles as the interfaces** (`DraftRepository`, `EntryRepository`), never an adapter class. Changing what backs the specs — storage behind IPC under a desktop shell, say — should then touch `src/testing/realRepositories.ts` alone. The contract suites are what make that swap safe.
- **A repository read doesn't retry.** In Cypress, place it after a UI assertion that waits on the same write; in Vitest, wrap it in `vi.waitFor`. Retrying only helps presence: an absence ("no draft was written") passes on the first try (see Don'ts).
- **When no UI marks the moment, wait on a signal the code already gives** rather than writing a polling helper: spy on the call that awaits the write, await its promise, then read plainly — for absence as well as presence, in both runners. For example, a draft session let go (the page left, a change of entry) calls `drafts.abandonDraft`, which resolves once its flush has landed.
- **Leave a page the way the writer would:** the header's links, and back through the page you left for (a Timeline card, the Drafts link). Where the same view stays mounted for another entry, push the router there: one the spec builds with `createTestRouter()` and hands to the mount, as `cy.mount`'s `router` option in Cypress.

**Unit specs are a non-component file's own.** They prove its code directly: many cases as a table of inputs, and timing, ordering and races driven deterministically. A store's fault handling — a failed write, a conflict — is proven in the store's spec; what a screen shows for one is the component's. A contract suite proves one interface across its implementations.

A behavior is proven once, in the spec of the file whose code it is. A component spec doesn't re-prove a store or composable it runs on, and a unit spec doesn't re-walk a component's wiring of it. Before deleting a test because another now covers it, check coverage for lines only it reached, since a test can exercise a path it never asserts.

## Don'ts

Be hardline on these, particularly for new tests.

- Don't over-abstract. No shared mock modules, selector maps, or elaborate data builders unless repetition has actually become noisy.
- Don't change source code to make a test easier without saying so. Never loosen a source type for a test's convenience; give the tests a fixture that fills the defaults, as `draftChangeTo` does.
- Don't use `defineComponent` in component tests; pass the component to `cy.mount` / `render`.
- Don't add triple-slash references in test files.
- Don't import `mount` directly. Use `cy.mount` in Cypress, `renderComponent` (not `render`) in Vitest Browser Mode.
- Don't assert absence without a baseline: something the test waits on that is guaranteed to come at or after the point the unwanted thing would have appeared — the element seen before the action that removes it, a later UI state, another write through the same path, a spied action resolving. A red run against unfixed code is no substitute; an absence checked too early passes either way.
- Don't reach for a test id when a role or text query works.
- Don't use a regex when an exact string matches. Reserve regex for genuinely partial or dynamic text, such as a version label embedded in a longer sentence.
- Don't duplicate an assertion on text that already governs an element's accessible name.
- Don't assert mere existence. Assert visibility for user-facing elements, except on elements you immediately interact with, since both runners already imply visibility for those.
- Don't comment every line. Comment a logical group, and only when the test name doesn't already say it.

## Queries and selectors

Accessibility first, in this order:

1. `getByRole('button', { name: 'Add entry' })`
2. `getByLabelText('Related entry')`
3. `getByText('Was attached to: “Lake Tahoe”')`
4. A test id, only when none of the above can express it

Both runners have these queries natively: Vitest Browser Mode as `screen.getBy*`, Cypress as `cy.findBy*` from `@testing-library/cypress`, wired up in `cypress/support/component.ts`. Reach for `cy.get` or `cy.contains` only when nothing above can express what you need.

Match on the **accessible name**, not merely visible text. For absence, prefer a role query over poking at `container.querySelector` or `container.textContent`:

```ts
expect(screen.getByRole('combobox', { name: 'Anchor action' }).query()).toBeNull() // Vitest
cy.findByRole('combobox', { name: 'Anchor action' }).should('not.exist') // Cypress
```

Test ids are legitimate when the thing being located has no semantic role at all, such as a plain container a test needs exact character offsets inside.

**Driving the editor.** `DocumentEditor` renders a contenteditable, which has no implicit role, so it sets `role="textbox"` and an `aria-label` from its `label` prop: query it as `getByRole('textbox', { name: 'New entry' })`. The title is a separate, ordinary input beside it — `getByRole('textbox', { name: 'Title' })` — so filling one leaves the other alone. Filling the body replaces its whole document; to append, click and use `{Control>}{End}{/Control}` (Cypress: `{ctrl}{end}`). Cypress's `.type()` has no `{tab}`; press it natively with `cy.press(Cypress.Keyboard.Keys.TAB)`.

## Structure and naming

- **Imperative, concise test names.** `renders the entry's own text`, not `should render the entry's own text`. Never lead with "should".
- **Group related assertions** that share setup. Split when setup is trivial and a clean dividing line exists.
- **Keep test data and helpers in the narrowest scope that uses them:** what serves one test goes inside its `it`. Mount with only the props that scenario needs.
- **Name a fixture after what it builds:** `makeDraft`, `draftChangeTo`.
- **Hard-code assertion values.** Prefer duplication over indirection until it gets noisy.
- **One blank line after mounting**, before the first assertion or interaction.
- **Chain with `.and()`** after the first `.should()` in Cypress.
- Don't remove an existing `.only` unless asked.

Someone should understand a test without leaving the file. Abstraction is justified when it speeds up intent recognition, hides a repeated precondition, or hides incidental multi-step mechanics. `mountDetail`, `makeRouter`, and `selectRange` earn their place on those grounds; a wrapper that merely shortens an assertion does not.

## Setup, spying, and mocking

- **Event listeners go in `attrs`, not `props`.** This matches how a parent writes `@submit`, in both runners:

  ```ts
  cy.mount(RelatedEntryForm, { props: { quote }, attrs: { onSubmit } })
  render(RelatedEntryForm, { props: { quote }, attrs: { onSubmit } })
  ```

- **Swap the repository, don't mock it.** Every spec in either runner starts on fresh, isolated, **real** storage — real IndexedDB via Dexie, real OPFS — which a global `beforeEach` in `cypress/support/component.ts` and `src/testing/browserSetup.ts` points the composition root at, using the helpers in `src/testing/realRepositories.ts`. A spec seeds it, stubs it and, in a flow, reads it through the composition root's own bindings, which point at that test's instances. Read them inside a test, never captured at module scope, where they'd hold a stale instance:

  ```ts
  import { draftRepository, entryRepository } from '@/repositories'
  ```

  Entries, drafts and mark sets share one uniquely-named database per test, exactly as `src/repositories/index.ts` shares one in production — a transaction cannot span two connections, so a spec covering the anchor-mode atomic seal has to be given the shape it will actually run against. Media gets its own OPFS directory. Neither is opened until first used, so a spec that never touches storage pays almost nothing, and everything created is disposed in one global `afterEach` per runner. The adapter specs call `freshXRepository()` themselves, since a contract wants an instance per factory call. Plain-Node `*.test.ts` unit tests construct `InMemoryEntryRepository` / `InMemoryDraftRepository` / `InMemoryMediaRepository` directly.

- **Fresh instance per test**, not a shared singleton that gets cleared. Isolation by construction.

- **Fixtures may record fake steps** (`{ stepType: 'replace' }`, `{ n: 1 }`) where nothing replays them; a test that types gets real ones from the editor. Revisit once the history view replays traces.

- **Mount through the shared helper, not the runner's mount function directly.** `cy.mount` (wired up in `cypress/support/component.ts`) and `renderComponent` (`src/testing/renderComponent.ts`, used in place of `vitest-browser-vue`'s `render`) both install a fresh Pinia automatically — every store-backed spec needs one, and it's an inert no-op for the ones that don't, so there's no reason to pass it by hand. `cy.mount` additionally accepts `routePath`, which builds a real router (the app's real route table, from `src/testing/testRouter.ts`, on isolated in-memory history), pushes to that path, and waits for it to be ready before mounting — useful for a spec like `EntryCard` or `EntryDetailView` that renders a `<router-link>` or calls `useRoute()`. A spec that reads where the component navigated, or pushes the router itself, builds the router with `createTestRouter()` and passes it as `router` alongside `routePath`, then reads it with `cy.wrap(router).its('currentRoute.value')`, which retries. Vitest specs needing a router build one directly with `createTestRouter()` and `await` its `push`/`isReady` inline; there's no `routePath` equivalent there because Vitest has no command queue to thread the wait through — plain `await` already does it.

## Formatting

Break a chain across lines when it exceeds roughly 120 characters or has four or more chained calls. Root on the first line, each subsequent call on its own line at one indent:

```ts
cy.findByRole('button', { name: 'Add entry' })
  .should('be.visible')
  .and('not.be.disabled')
  .and('have.attr', 'type', 'submit')
```

Don't introduce a helper purely to reduce vertical size. Readability beats density.

## Running Cypress

`npm run cy:run` (headless) or `npm run cy` (interactive).

## Coverage

Coverage finds behaviors without a test; it isn't a line target. A gap earns a test when it guards an invariant or something the writer would notice: an `asOf` path, a guard that refuses a bad write, a fold over stored data that must terminate. It doesn't for a defensive early return, a branch reachable only through a type cast, or a view that only arranges its children.

`npm run test:coverage` runs both the `unit` and `browser` Vitest projects with coverage and writes a report to `coverage/` (gitignored). The provider is `istanbul`, not the usual `v8` default: v8 coverage needs Node's inspector, which Browser Mode's Playwright tab doesn't expose, so v8 simply can't instrument the `browser` project at all. Istanbul instruments the source itself, so it works for both projects with one config block. It's also what `@cypress/code-coverage` consumes, so wiring Cypress into the same coverage run later — a natural next comparison, alongside Vitest Browser Mode vs. Cypress as runners — is a small addition rather than a second provider to reconcile. Cypress isn't wired into coverage yet; only Vitest is.

## Clearing local data by hand

When entries or drafts from manual testing have problems, clear them rather than writing code to tolerate them (see CLAUDE.md, "No backward compatibility"). From the browser console:

```js
const req = indexedDB.open('chronicle')
req.onsuccess = () => {
  req.result.transaction('drafts', 'readwrite').objectStore('drafts').clear()
}
```

Swap `'drafts'` for `'entries'` to clear those instead, or delete the whole database from DevTools → Application → IndexedDB. Every spec gets a uniquely-named database, disposed in the global `afterEach`.

## Known gaps

- A draft's multi-tab behavior (tab return, two tabs saving at once, leaving a tab) is tested with the other tab simulated: a second Pinia over the same database, driven through its store rather than a UI, and the browser's own events dispatched in place of switching, hiding or closing a tab: `focus`, `pagehide` and `beforeunload` on `window`, and `visibilitychange` on `document` with `visibilityState` shadowed by an own property, deleted after each test. A real second tab and a real reload wait for an end-to-end layer, which doesn't exist yet.
- A related-entry draft that can't be reopened shows both halves read-only, the parent with the anchors it placed (`RelatedEntryComposer`, reached through `EntryDetailView`). No spec covers that view yet; the read-only state is covered through `EntryComposer` alone.
