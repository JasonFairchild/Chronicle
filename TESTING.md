# Chronicle Testing Guidelines

How tests are written here and why. These apply to component tests in **both** runners: anything
said about Cypress applies to Vitest Browser Mode unless noted, since the two run deliberately
duplicated specs for tool comparison.

## Where tests live

| Suffix              | Runner              | Environment   | What belongs here                                              |
| ------------------- | ------------------- | ------------- | -------------------------------------------------------------- |
| `*.test.ts`         | Vitest, `unit`      | node          | Pure logic: the fold, anchor resolution, id generation, stores |
| `*.browser.test.ts` | Vitest, `browser`   | real Chromium | Components, and anything needing real browser APIs             |
| `*.cy.ts`           | Cypress             | real browser  | Components, mirroring the `.browser.test.ts` spec              |
| `*.contract.ts`     | imported, never run | either        | A shared suite run against multiple implementations            |

**Duplicate component specs are intentional.** `EntryCard.browser.test.ts` and
`EntryCard.cy.ts` cover the same cases on purpose, to compare the two runners. Don't consolidate
them.

**Cypress should keep up with Vitest Browser Mode.** Default to mirroring every `.browser.test.ts`
into a `.cy.ts`, the same as any other duplicated pair. Skip the mirror only when there is a real
obstacle, not merely because the thing under test isn't a `.vue` file — a composable can still be
driven through a small host component. `DexieEntryRepository` is the genuine case: a plain data-layer
class with nothing to mount, so it is proven in the Vitest browser project alone.

**Contract suites are for interfaces with more than one implementation.** Each of the four
repositories exports one: `entryRepository.contract.ts`, `draftRepository.contract.ts` and
`markSetRepository.contract.ts` (each in-memory and Dexie), and `mediaRepository.contract.ts`
(in-memory and OPFS). That is what makes "swap the storage backend by changing one line" provable rather than
asserted. They are named `.contract.ts` precisely so no runner picks them up directly.

The persistent halves run in the browser project only — Dexie needs real IndexedDB and OPFS needs a
real origin private file system, and neither has anything to fall back to in node.

## Philosophy

- **Test from the user's perspective.** Simulate real interaction and assert what a user can see.
  Don't assert internal state, private methods, or DOM structure nobody interacts with.
- **Don't test child components.** They get their own specs, or are treated as third party.
  Selecting or interacting with a child's elements as a means to an end is fine; asserting on
  behavior that belongs to the child is not.
- **Prefer whole flows.** One test covering a complete scenario beats several granular ones. Longer
  tests are fine when they represent one coherent idea, such as select a passage, strike it, propose
  wording, save, and see it rendered.
- **Prefer spying over mocking.** Use real logic wherever possible so tests exercise real code
  paths. Minimize mocking, especially at first.

## Don'ts

Be hardline on these, particularly for new tests.

- Don't over-abstract. No shared mock modules, selector maps, or elaborate data builders unless
  repetition has actually become noisy.
- Don't change source code to make a test easier without saying so.
- Don't use `defineComponent` in component tests; pass the component to `cy.mount` / `render`.
- Don't add triple-slash references in test files.
- Don't import `mount` directly. Use `cy.mount` in Cypress, `renderComponent` (not `render`) in
  Vitest Browser Mode.
- Don't reach for a test id when a role or text query works.
- Don't use a regex when an exact string matches. Reserve regex for genuinely partial or dynamic
  text, such as a version label embedded in a longer sentence.
- Don't duplicate an assertion on text that already governs an element's accessible name.
- Don't assert mere existence. Assert visibility for user-facing elements, except on elements you
  immediately interact with, since both runners already imply visibility for those.
- Don't comment every line. Comment a logical group, and only when the test name doesn't already
  say it.

## Queries and selectors

Accessibility first, in this order:

1. `getByRole('button', { name: 'Add entry' })`
2. `getByLabelText('Your note')`
3. `getByText('Was attached to: “Lake Tahoe”')`
4. A test id, only when none of the above can express it

Both runners have these queries natively: Vitest Browser Mode as `screen.getBy*`, Cypress as
`cy.findBy*` from `@testing-library/cypress`, wired up in `cypress/support/component.ts`. Reach for
`cy.get` or `cy.contains` only when nothing above can express what you need.

Match on the **accessible name**, not merely visible text. For absence, prefer a role query over
poking at `container.querySelector` or `container.textContent`:

```ts
expect(screen.getByRole('combobox', { name: 'Anchor action' }).query()).toBeNull() // Vitest
cy.findByRole('combobox', { name: 'Anchor action' }).should('not.exist') // Cypress
```

Test ids are legitimate when the thing being located has no semantic role at all. The entry body in
`EntryDetailView` carries `data-testid="entry-content"` because a selection test needs that exact
element to compute character offsets, and no role identifies it.

**Driving the editor.** `DocumentEditor` renders a contenteditable, which has no implicit role, so
it sets `role="textbox"` and an `aria-label` from its `label` prop: query it as
`getByRole('textbox', { name: 'New entry' })`. The title is a separate, ordinary input beside it —
`getByRole('textbox', { name: 'Title' })` — so filling one leaves the other alone. Filling the body
replaces its whole document; to append, click and use `{Control>}{End}{/Control}` (Cypress:
`{ctrl}{end}`). Cypress has no `{tab}` sequence (cypress-io/cypress#299), so a spec that needs Tab
dispatches the keydown on `cy.focused()` — see `DocumentEditor.cy.ts`.

## Structure and naming

- **Imperative, concise test names.** `renders the entry's own text`, not
  `should render the entry's own text`. Never lead with "should".
- **Group related assertions** that share setup. Split when setup is trivial and a clean dividing
  line exists.
- **Keep test data local** to the `it` or its enclosing `describe`. Mount with only the props that
  scenario needs.
- **Hard-code assertion values.** Prefer duplication over indirection until it gets noisy.
- **One blank line after mounting**, before the first assertion or interaction.
- **Chain with `.and()`** after the first `.should()` in Cypress.
- Don't remove an existing `.only` unless asked.

Someone should understand a test without leaving the file. Abstraction is justified when it speeds
up intent recognition, hides a repeated precondition, or hides incidental multi-step mechanics.
`mountDetail`, `makeRouter`, and `selectRange` earn their place on those grounds; a wrapper that
merely shortens an assertion does not.

## Setup, spying, and mocking

- **Event listeners go in `attrs`, not `props`.** This matches how a parent writes `@submit`, in
  both runners:

  ```ts
  cy.mount(ChildEntryForm, { props: { quote }, attrs: { onSubmit } })
  render(ChildEntryForm, { props: { quote }, attrs: { onSubmit } })
  ```

- **Swap the repository, don't mock it.** In a `*.cy.ts` or `*.browser.test.ts` spec, point the
  composition root at a fresh **real** adapter — real IndexedDB via Dexie, real OPFS — using the
  helpers in `src/testing/realRepositories.ts`:

  ```ts
  entries = freshEntryRepository() // DexieEntryRepository, real IndexedDB
  freshDraftRepository()
  freshMediaRepository()
  ```

  Call only the ones a given spec actually needs; a component that never touches storage directly
  needs none of them. Entries and drafts share one uniquely-named database per test, exactly as
  `src/repositories/index.ts` shares one in production — a transaction cannot span two connections,
  so a spec covering the anchor-mode atomic seal has to be given the shape it will actually run
  against. Media gets its own OPFS directory. Everything created registers itself for cleanup;
  `cypress/support/component.ts` and `src/testing/browserSetup.ts` each dispose everything created
  in one global `afterEach`, so a spec that creates nothing pays nothing. Plain-Node `*.test.ts`
  unit tests are the exception: IndexedDB/OPFS don't exist in Node, so those swap in
  `InMemoryEntryRepository` / `InMemoryDraftRepository` / `InMemoryMediaRepository` directly.

- **Fresh instance per test**, not a shared singleton that gets cleared. Isolation by construction.

- **Mount through the shared helper, not the runner's mount function directly.** `cy.mount` (wired
  up in `cypress/support/component.ts`) and `renderComponent` (`src/testing/renderComponent.ts`,
  used in place of `vitest-browser-vue`'s `render`) both install a fresh Pinia automatically —
  every store-backed spec needs one, and it's an inert no-op for the ones that don't, so there's no
  reason to pass it by hand. `cy.mount` additionally accepts `routePath`, which builds a real
  router (the app's real route table, from `src/testing/testRouter.ts`, on isolated in-memory
  history), pushes to that path, and waits for it to be ready before mounting — useful for a spec
  like `EntryCard` or `EntryDetailView` that renders a `<router-link>` or calls `useRoute()`.
  Vitest specs needing a router build one directly with `createTestRouter()` and `await` its
  `push`/`isReady` inline; there's no `routePath` equivalent there because Vitest has no command
  queue to thread the wait through — plain `await` already does it.

## Formatting

Break a chain across lines when it exceeds roughly 120 characters or has four or more chained
calls. Root on the first line, each subsequent call on its own line at one indent:

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

`npm run test:coverage` runs both the `unit` and `browser` Vitest projects with coverage and writes
a report to `coverage/` (gitignored). The provider is `istanbul`, not the usual `v8` default: v8
coverage needs Node's inspector, which Browser Mode's Playwright tab doesn't expose, so v8 simply
can't instrument the `browser` project at all. Istanbul instruments the source itself, so it works
for both projects with one config block. It's also what `@cypress/code-coverage` consumes, so
wiring Cypress into the same coverage run later — a natural next comparison, alongside Vitest
Browser Mode vs. Cypress as runners — is a small addition rather than a second provider to reconcile.
Cypress isn't wired into coverage yet; only Vitest is.

## Clearing local data by hand

When entries or drafts from manual testing have problems, clear them rather than writing code
to tolerate them (see CLAUDE.md, "No backward compatibility"). From the browser console:

```js
const req = indexedDB.open('chronicle')
req.onsuccess = () => {
  req.result.transaction('drafts', 'readwrite').objectStore('drafts').clear()
}
```

Swap `'drafts'` for `'entries'` to clear those instead, or delete the whole database from DevTools →
Application → IndexedDB. Browser specs gets a uniquely-named DB, disposed in the global `afterEach`.

## Known gaps

- Nothing outstanding.
