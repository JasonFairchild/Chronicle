# Chronicle Testing Guidelines

How tests are written here and why. These apply to component and flow specs in **both** runners: anything said about Cypress applies to Vitest Browser Mode unless noted, since the two run deliberately duplicated specs for tool comparison.

## Where tests live

| Suffix | Runner | Environment | What belongs here |
| --- | --- | --- | --- |
| `*.test.ts` | Vitest, `unit` | node | Pure logic; timing, races and faults the UI can't drive |
| `*.browser.test.ts` | Vitest, `browser` | real Chromium | Components, and anything needing real browser APIs |
| `*.cy.ts` | Cypress | real browser | Components, mirroring the `.browser.test.ts` spec |
| `*.flow.browser.test.ts` | Vitest, `browser` | real Chromium | Flows: the app from a route, down to what's stored |
| `*.flow.cy.ts` | Cypress | real browser | Flows, mirroring the `.flow.browser.test.ts` spec |
| `*.contract.ts` | imported, never run | either | A shared suite run against multiple implementations |

**A flow spec sits beside the view its route starts on**, whatever screens it passes through: a flow from `/entries/new` lives in `NewEntryView.flow.cy.ts`. `App`'s own flows — tab return, flushing on leave — sit beside `App.vue`. The runners' existing globs already match the `.flow.` names; to run only flows, pass `--spec "src/**/*.flow.cy.ts"` to Cypress or `.flow.` to Vitest as a filter.

**Duplicate specs are intentional.** `EntryCard.browser.test.ts` and `EntryCard.cy.ts` cover the same cases on purpose, to compare the two runners, and flow specs pair the same way. Don't consolidate them.

**Cypress should keep up with Vitest Browser Mode.** Default to mirroring every `.browser.test.ts` into a `.cy.ts`, the same as any other duplicated pair. Skip the mirror only when there is a real obstacle, not merely because the thing under test isn't a `.vue` file — a composable can still be driven through a small host component. `DexieEntryRepository` is the genuine case: a plain data-layer class with nothing to mount, so it is proven in the Vitest browser project alone.

**Contract suites are for interfaces with more than one implementation.** Each of the four repositories exports one: `entryRepository.contract.ts`, `draftRepository.contract.ts` and `markSetRepository.contract.ts` (each in-memory and Dexie), and `mediaRepository.contract.ts` (in-memory and OPFS). That is what makes "swap the storage backend by changing one line" provable rather than asserted. They are named `.contract.ts` precisely so no runner picks them up directly.

The persistent halves run in the browser project only — Dexie needs real IndexedDB and OPFS needs a real origin private file system, and neither has anything to fall back to in node.

## Philosophy

- **Test from the user's perspective.** Simulate real interaction and assert what a user can see. Don't assert internal state, private methods, or DOM structure nobody interacts with.
- **Don't test child components.** They get their own specs, or are treated as third party. Selecting or interacting with a child's elements as a means to an end is fine; asserting on behavior that belongs to the child is not. Where a parent only configures a child and the one visible result is styling — a table's `striped` prop, say — assert the prop it passes (`findComponent(Table).props('striped')`), not the computed CSS; the child's spec already proves what the prop does.
- **Prefer whole scenarios.** One test covering a complete scenario beats several granular ones. Longer tests are fine when they represent one coherent idea, such as select a passage, strike it, propose wording, save, and see it rendered.
- **Never mock what's in scope.** Everything a spec is about runs for real, watched with a spy where the screen can't show it. For a component spec, that is the component's own script, the children it renders, what it emits, where it navigates, and the stores and composables it runs on. What's outside the scope still runs, but the spec doesn't check it. For a component spec that's storage: seeded the way an intercept seeds a page, stubbed to fail when the failure is the point, and never read back.
- **Use a fail first approach.** Every new test should be proven to fail as expected before being made to pass. For already working code, it can be broken, tested then restored.

## Layers

Tests are one design, judged together rather than file by file. There are three levels — component, flow and unit — and overlap between them is kept to a minimum, unlike the Cypress ↔ Browser Mode duplication, which is deliberate. One question places a test: **does it check what was stored, or reach another screen?** Yes makes it a flow spec. No makes it a component spec, unless it has one of the reasons for a unit test below.

**Component specs are the screen alone.** They mount the component under test. Storage runs real and isolated beneath it, as for every spec (see "Swap the repository" below), but it's the backend, out of scope, and is handled the way a request intercept handles one:

- **Seed it** through the repository interface before mounting, with whatever the screen shows.
- **Fail it** by stubbing one repository method to reject, when what the screen shows for a failure is the point.
- **Never read it back.** Assert through the UI and the component's own outputs — what it emits, where it navigates. What reached storage is a flow's to check.

The exception is a unit whose job is storage, such as `useMedia`, or `DocumentEditor` storing an attached image: what it stores is its output, so its spec reads it back.

A component spec owns everything its own code produces: every state its screen can show, how it responds — empty and error states, validation, what each control does there — and where it sends the writer next. It owns them even when a flow walks through them.

**Flow specs are narrow end-to-end tests.** They mount `App` at a route and prove a path from the click down to what's stored, across as many screens as it takes. A flow walks one path per user goal and checks where it ends — the saved entry on its page, a draft kept when the page is left. What each screen does along the way, such as where it navigates, the flow leans on without asserting: it fails if that breaks, but the screen's own spec is where it's checked. Keep them independent of which backend is real:

- **Arrange through the repository interface, act through the UI, assert through the UI.** Read the repository only for what no screen can show: nothing left on disk, the original row untouched, a trace that has no view yet.
- **Type storage handles as the interfaces** (`DraftRepository`, `EntryRepository`), never an adapter class. Changing what backs the specs — storage behind IPC under a desktop shell, say — should then touch `src/testing/realRepositories.ts` alone. The contract suites are what make that swap safe.
- **A repository read doesn't retry.** In Cypress, place it after a UI assertion that waits on the same write; in Vitest, wrap it in `vi.waitFor`. Retrying only helps presence: an absence ("no draft was written") passes on the first try (see Don'ts).
- **When no UI marks the moment, wait on a signal the code already gives** rather than writing a polling helper: spy on the call that awaits the write, await its promise, then read plainly — for absence as well as presence, in both runners. For example, a draft session let go (the page left, a change of entry) calls `drafts.abandonDraft`, which resolves once its flush has landed.
- **Leave a page the way the writer would:** the header's links, and back through the page you left for (a Timeline card, the Drafts link). Where the same view stays mounted for another entry, push the router there; in Cypress, the mounted wrapper's `vm.$router`.

**A unit test is warranted on top of component and flow coverage for:**

1. Pure logic with many cases, where a table of inputs beats a UI scenario per case.
2. Timing, ordering and races the UI can't drive deterministically.
3. How a store handles a fault — a failed write, a conflict. What a screen shows for one is a component spec's.
4. Contracts: one interface, several implementations.
5. Definitions whose value is the point: the schema, the route table, a constant.

Not for re-walking a path a component or flow spec already walks, or re-proving a child's behavior. When a component or flow spec comes to cover the reason a unit test exists, delete the unit test.

## Don'ts

Be hardline on these, particularly for new tests.

- Don't over-abstract. No shared mock modules, selector maps, or elaborate data builders unless repetition has actually become noisy.
- Don't change source code to make a test easier without saying so.
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
- **Keep test data local** to the `it` or its enclosing `describe`. Mount with only the props that scenario needs.
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

- **Mount through the shared helper, not the runner's mount function directly.** `cy.mount` (wired up in `cypress/support/component.ts`) and `renderComponent` (`src/testing/renderComponent.ts`, used in place of `vitest-browser-vue`'s `render`) both install a fresh Pinia automatically — every store-backed spec needs one, and it's an inert no-op for the ones that don't, so there's no reason to pass it by hand. `cy.mount` additionally accepts `routePath`, which builds a real router (the app's real route table, from `src/testing/testRouter.ts`, on isolated in-memory history), pushes to that path, and waits for it to be ready before mounting — useful for a spec like `EntryCard` or `EntryDetailView` that renders a `<router-link>` or calls `useRoute()`. Vitest specs needing a router build one directly with `createTestRouter()` and `await` its `push`/`isReady` inline; there's no `routePath` equivalent there because Vitest has no command queue to thread the wait through — plain `await` already does it.

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

- A draft's multi-tab behavior (tab return, two tabs saving at once, leaving a tab) is tested with the other tab simulated: a second Pinia over the same database, driven through its store rather than a UI, and the browser's own events dispatched in place of switching, hiding or closing a tab: `focus` and `pagehide` on `window`, and `visibilitychange` on `document` with `visibilityState` shadowed by an own property, deleted after each test. A real second tab and a real reload wait for an end-to-end layer, which doesn't exist yet.
