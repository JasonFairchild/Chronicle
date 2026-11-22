# Chronicle Testing Guidelines

How tests are written here and why. What this says about Cypress applies to Vitest Browser Mode unless noted.

## Principles

Most important first, each followed by what it asks of a test.

### 1. A test is evidence of what the code does

It is a specification only where it states a sentence from PRODUCT.md, AUTHORING.md or ENTRY_MODEL.md. Check behavior against the doc, not against the test. Where the two disagree, or a test pins something nothing reads, raise it; don't conform to it.

### <a id="spec-comprehension"></a>2. Someone should understand a test without leaving the file

Tests show exactly how the app behaves, so they're where a reader learns its details. What a test needs is in its file, and as near the test as it can be, so reading one takes little jumping around.

- **2.1 -** Abstract only what hides noise. A helper earns its place when it speeds up recognizing intent, hides a repeated precondition, or hides incidental multi-step mechanics: one that mounts a view with data not asserted, or `selectTextRange`, which selects text in the editor by character offsets. Two tests sharing a few lines isn't reason enough when the helper hides a detail a reader would stop to ask about, or a step that can fail, since the failure then points at a line outside the test. A wrapper that merely shortens an assertion doesn't earn its place, and neither do shared mock modules, selector maps or elaborate data builders before repetition has become noisy.
- **2.2 -** Keep test data and helpers in the narrowest scope that uses them: what serves one test goes inside its `it`. Mount with only the props that scenario needs.
- **2.3 -** One idea per test, at whatever size it takes. Longer tests are fine when they represent one coherent idea, such as select a passage, strike it, propose wording, save, and see it rendered. A test can equally be as small as one line of its file: a spy on one call across an unmount is how a component proves its `onBeforeUnmount`.
- <a id="group-by-state"></a>**2.4 -** Group by where a test stands, not by what it claims. Before adding a test, look for one that already reaches that state, and extend it instead. Assertions at the same point on the same page belong in one test; split only where setup differs or the flow branches.
- **2.5 -** Hard-code assertion values, and name one only rarely. A failure prints the value, and the reader should find that same value in the assertion it cites, not a name standing for it. Name a value only when tests must share it as one thing, which is rare, or when it's long enough that a name reads much better; otherwise the seed and the assertion each spell it out.
- **2.6 -** Each test seeds its own data, in strings no other test in the file uses, so a value in a test or its failure plainly belongs to that test, and state leaked from another test fails an assertion rather than satisfying it. The Browser Mode and Cypress copies of one test share theirs.
- **2.7 -** Name a fixture after what it builds: `makeDraft`, `draftChangeTo`.
- **2.8 -** Imperative, concise test names. `shows the title`, not `should show the title`. Never lead with "should".
- **2.9 -** One blank line after mounting, before the first assertion or interaction, and chain with `.and()` after the first `.should()` in Cypress.

### <a id="proven-once"></a>3. Each behavior is proven once, in the spec of the file whose code it is

Tests are one design, judged together rather than file by file, at three levels. A unit spec is a non-component file's own, and a component spec is the screen alone. A flow spec is a narrow end-to-end test of files working together. One question places a test beyond a file's own spec: **does it check what was stored, or reach another screen?** Yes makes it a flow spec, unless storing is the file's own job ("Component specs").

- **3.1 -** Each file has a spec of its own, proving the code in it at its seams: what it takes in, what it produces, what it calls on the files it uses. The real stack beneath is how a spec acts and observes, not what it's about. A file with nothing worth proving is a candidate to merge into its caller; a definitions file whose value is the point, such as the schema or the route table, tests that value.
- **3.2 -** For a component, what it produces is everything its screen does: every state it can show, how it responds — empty and error states, validation, what each control does there — and where it sends the writer next, even when a flow walks through them. A link is checked by its `href`, not followed: landing there is the destination's to prove.
- **3.3 -** A file's users prove only their wiring of it. A component spec doesn't re-prove the store it runs on: the store's spec proves its fault handling, a failed write or a conflict, and the screen's proves what it shows for one. A flow leans on what each screen does along the way, such as where it navigates, without asserting it.
- **3.4 -** Don't test child components. They get their own specs, or are treated as third party. Selecting or interacting with a child's elements as a means to an end is fine; asserting on behavior that belongs to the child is not.
- **3.5 -** Where a parent only configures a child, assert the configuration, not its effect. A table's `striped` prop, say, darkens every other row: the table's own spec proves that once, and each parent proves it passes `striped` under the right conditions, not the row colors.
- **3.6 -** The one deliberate duplicate is the mirror. A `.browser.test.ts` and its `.cy.ts` have the same cases, to compare the two runners: don't consolidate them.
- **3.7 -** A script gets a spec when it holds many-case logic, as the citation resolver does; one that only glues other tools together, such as `checkStaged.ts` or `renderDiagram.ts`, is proven by running it.

### <a id="fail-first"></a>4. A test must be proven to fail

A test that passes whatever the code does proves nothing.

- <a id="see-it-fail"></a>**4.1 -** See every new test fail before it passes, on its assertion and for the reason it names: not on setup, a wrong query, a timeout or a crash on the way there, and on each claim of a test that makes several. For code that already exists, break it, run, and restore.
- **4.2 -** State what a test expects; import only what it feeds in. A value a test checks against (a timing, a limit, a label) is written in the test, from the doc that decides it. Imported from the code under test, it moves with the code, and the test can't fail. Fixtures, builders and the real route table are inputs, and may be shared.
- <a id="absence-baseline"></a>**4.3 -** Don't assert absence without a baseline: something the test waits on that is guaranteed to come at or after the point the unwanted thing would have appeared — the element seen before the action that removes it, a later UI state, another write through the same path, a spied action resolving. A red run against unfixed code is no substitute; an absence checked too early passes either way.

### 5. Run the code the app runs

- **5.1 -** Never mock what's in scope. Everything a spec is about runs for real. For a component spec, that is the component's own script, the children it renders, what it emits and where it navigates. The stores, composables and storage it runs on still run for real beneath it. A spec may hand its file a stand-in for an input it reads only part of, such as a session holding just the fields the file reads.
- <a id="test-only-source"></a>**5.2 -** Source carries nothing only tests use. A test goes through the path the app takes. `npm run unused` catches an export only a spec imports; what it can't see is a loosened type, an optional field or parameter, or an attribute or wrapper element added for a test. Give the tests a fixture that fills the defaults instead, as `draftChangeTo` does, and say so whenever source changes to make a test easier.
- **5.3 -** Run on the app's own storage. Specs use the composition root's real repositories from `@/repositories`, typed as the interfaces, never an adapter class outside that adapter's own spec. `src/testing/testStorage.ts` empties them before and after every test. Node runs Dexie on `fake-indexeddb`, with no OPFS for media. Teardown waits for every write a test started, so a test that holds a call in flight releases it before it ends; one still running after 5s fails the test. A storage call or store action that lands after its test has ended fails the next test. Stubs restore themselves between tests.
- **5.4 -** Mount through `cy.mount` or `renderComponent`, never `mount` or `render` directly: they give each test a fresh Pinia.

### <a id="user-perspective"></a>6. Test from the user's perspective, where there is one

Simulate real interaction and assert what a user can see. Where a file's output isn't on screen — a call it makes on another file, what a lifecycle hook does — assert that call directly with a spy. Don't assert what's internal to a screen: a component's own refs or methods, the store state behind what it shows, or DOM structure nobody interacts with. Where there is no user, as in a store's own spec, the file's state is its output, and asserting it is right.

- <a id="query-like-user"></a>**6.1 -** Query the way a user finds things, by accessible name rather than merely visible text. Both runners have these queries, Vitest Browser Mode as `screen.getBy*` and Cypress as `cy.findBy*` from `@testing-library/cypress`; reach for `cy.get`, `cy.contains` or `container.querySelector` only when none of them can express what you need. In this order:
  1. `getByRole('button', { name: 'Submit' })`
  2. `getByLabelText('Email')`
  3. `getByText('No results')`
  4. A test id, only for what none of the above can reach: a plain container a test needs exact character offsets inside, or a hidden input
- **6.2 -** Don't use a regex when an exact string matches. Reserve regex for genuinely partial or dynamic text, such as a version label embedded in a longer sentence.
- **6.3 -** Don't assert mere existence. Assert visibility for user-facing elements, except on elements you immediately interact with, since both runners already imply visibility for those.

## <a id="layers"></a>Layers

Where each level's specs live, and how each is written. Which level a test belongs to is principle §3's.

| Suffix | Runner | Environment | What belongs here |
| --- | --- | --- | --- |
| `*.test.ts` | Vitest, `unit` | node, IndexedDB from `fake-indexeddb` | Source that needs no browser: domain, editor, stores, composables, types, utils |
| `*.browser.test.ts` | Vitest, `browser` | real Chromium | Components, and anything needing real browser APIs |
| `*.cy.ts` | Cypress | real browser | The same, mirroring the `.browser.test.ts` spec |
| `*.flow.browser.test.ts` | Vitest, `browser` | real Chromium | Flows: the app from a route, down to what's stored |
| `*.flow.cy.ts` | Cypress | real browser | Flows, mirroring the `.flow.browser.test.ts` spec |
| `*.contract.ts` | imported by an adapter's `.browser.test.ts` | real Chromium | What any implementation of an interface must do |

### <a id="component-specs"></a>Component specs

They mount the component under test. Storage runs for real beneath it, but the spec treats it as an out-of-scope backend, the way a spec with request intercepts treats a server:

- **Seed it** through the repository interface before mounting, with what the component needs. Entries go in with `seedEntry` (`src/testing/`), through `createMany` as the app writes them.
- **Fail it** by stubbing one repository method to reject, as an intercept would answer with a 500, when what the screen shows for a failure is the point.
- <a id="never-read-back"></a>**Never read it back.** If a spec needs storage to see a result, first ask whether the screen should show it; what reached storage is a flow's to check. The exception is a unit whose job is storing, such as `useMedia`, or `EditorToolbar` storing an attached image: what it stores is its output, so its spec reads it back.

### Flow specs

They mount `App` at a route and walk one path per user goal, across as many screens as it takes, checking where it ends — the saved entry on its page, a draft kept when the page is left. A flow sits beside the view its route starts on, whatever screens it passes through: a flow from `/entries/new` lives in `NewEntryView.flow.cy.ts`, and `App`'s own flows — tab return, flushing on leave — beside `App.vue`.

Arrange through the repository interface, so a flow doesn't depend on which backend is real, and read it only for what no screen can show: nothing left on disk, the original row untouched, a trace that has no view yet. A repository read doesn't retry, so wait for the write to land first: on what the screen shows once it has, or, where the screen shows nothing, on a spied call whose promise settles then, rather than a polling helper of your own. A draft session let go (the page left, a change of entry), say, calls `drafts.abandonDraft`, which resolves once its flush has landed.

Leave a page the way the writer would, by the header's links or back through the page you left for (a Timeline card, the Drafts link); push the router only where the same view stays mounted for another entry.

### Unit specs

They prove a file's code directly: many cases as a table of inputs, and timing, ordering and races driven deterministically.

**A contract suite proves once what every implementation of an interface must do.** A repository gets one only once a second backend is planned for it, as entries and drafts have ([CLAUDE.md, "Landmarks"](CLAUDE.md#landmarks)); mark sets and media are proven by their one adapter's spec. Contracts run in the browser only: in node, Dexie runs on `fake-indexeddb`, so a contract would prove the fake rather than the adapter.

## Coverage

Coverage finds behaviors without a test; it isn't a line target. A gap earns a test when it guards an invariant or something an app user would notice: an `asOf` path, a guard that refuses a bad write, a fold over stored data that must terminate. It doesn't for a defensive early return, a branch reachable only through a type cast, or a view that only arranges its children.

`npm run test:coverage` runs both Vitest projects and writes `coverage/`. The provider is istanbul, which Cypress's coverage plugin also reads; Cypress isn't wired in yet.

## <a id="clearing-data"></a>Clearing local data by hand

When entries or drafts from manual testing have problems, clear them rather than writing code to tolerate them (see [CLAUDE.md §1.1](CLAUDE.md#no-backward-compat)). From the browser console:

```js
const req = indexedDB.open('chronicle')
req.onsuccess = () => {
  req.result.transaction('drafts', 'readwrite').objectStore('drafts').clear()
}
```

Swap `'drafts'` for `'entries'` to clear those instead, or delete the whole database from DevTools → Application → IndexedDB. Specs use the same name, but in their own browser and on their own origin, so they never touch what the dev server's tab stores.
