# Test mechanics

How-to that TESTING.md's rules leave to the writer: where the two runners differ, setup details that have bitten before, and assertion habits to avoid.

## Where the runners differ

- **Retrying.** Cypress retries queries and `.should`, but not a `cy.then` callback, so it waits on a spy as `should('have.been.called')`, then the call's returned promise. `vi.waitFor` retries any block, so Vitest may retry a repository read itself, for presence only: an absence passes on the first try.
- **Spies.** `vi.spyOn` and `cy.spy` both work on a Pinia store's actions after mounting. Each exposes the call's returned promise: `mock.results[0]!.value` / `firstCall.returnValue`.
- **Seeding.** Inline `await` in Vitest; one `cy.then(async …)` yielding what the test uses in Cypress, not nested chains.
- **Exact text.** `toHaveTextContent` is partial; `have.text` is exact, down to the space Vue keeps around static template text (it trims around `{{ }}`), so static text takes `contain.text`. Vitest's exact form is a locator intersection asserted visible: `getByRole('alert').and(getByText(text, { exact: true }))`.
- **Another tab.** A second Pinia over the same database, from `createTrackedPinia()`. In Cypress, set it active in a `cy.then` before `cy.mount`, which installs its own. Returning to the tab is `focus` on `window` (`cy.window()` in Cypress). Hiding it is `visibilitychange` on `document`, with `visibilityState` shadowed by an own property, deleted after the test.
- **Driving the editor.** Its body is `getByRole('textbox', { name: <its label prop> })`. `fill` replaces the whole document; to append, click, then `{Control>}{End}{/Control}` (Cypress: `{ctrl+end}`). Cypress's `.type()` has no `{tab}`: `cy.press(Cypress.Keyboard.Keys.TAB)`.
- **Enter on a button.** `cy.press(Enter)` doesn't activate a focused button; click it instead.
- **Real input.** Vitest's `userEvent` is trusted browser input, through Playwright. Cypress's `click` and `type` are synthesized in the page, so the browser's own handling doesn't run: a click puts the caret at the element's end, not where it lands. Where a test needs that handling, use `cypress-real-events`' `realClick({ x, y })`, as `DocumentEditor.cy.ts` does.
- **Component internals.** `cy.mount` yields `{ wrapper }`, the Vue Test Utils wrapper (`setProps`, `findComponent`); `vitest-browser-vue`'s `render` gives only `rerender` and `emitted`.

## Setup

- **Listeners go in `attrs`, not `props`,** as a parent writes `@change`: `attrs: { onChange }`, in both runners.
- **A Pinia a spec makes itself comes from `createTrackedPinia()`,** as every node store spec's does, so teardown can drain it.
- **Mounting with a router.** `cy.mount`'s `routePath` mounts behind the real route table; a spec that reads where the component navigated, or pushes the router itself, passes its own `createTestRouter()` as `router` and reads `cy.wrap(router).its('currentRoute.value')`, which retries. Vitest has no `routePath`: `await` the router's `push` and `isReady`, then pass it in `global.plugins`.
- **Test helpers by alias** (`@/testing/…`, which lint holds): a relative path loads a second copy, whose Pinia the setup files' teardown never drains.
- **Read a router's address before unmounting the app.** When its last app unmounts, vue-router returns it to `/`, so a reload simulated by remounting at `currentRoute.fullPath` lands at the start instead.
- **Don't put the caret at an editor's start just as it gains focus.** Within 200ms of a focus event, with no click in the last 300ms, ProseMirror reads a collapsed selection at the document's start as the browser resetting it, and restores its own (`prosemirror-view`'s `domobserver.ts`). So `selectTextRange(el, 0, 0)` right after focusing an unfocused editor is silently undone; do it once the editor has focus, where `focus()` fires no event.
- **In node, a write a fake timer starts can still be in flight when `vi.advanceTimersByTimeAsync` returns:** fake-indexeddb runs on real `setImmediate`. Spy on the repository call, assert it was made, and await its returned promise before reading back.
- **Fail a write by stubbing the `@/repositories` binding before mounting:** `cy.stub(draftRepository, 'seal').rejects(…)`, `vi.spyOn(…).mockRejectedValue(…)`.
- **Fixtures may record fake steps** (`{ stepType: 'replace' }`, `{ n: 1 }`) where nothing replays them; a test that types gets real ones from the editor.

## Asserting

- **A query by accessible name already asserts that text,** so don't assert the same text on the element again.
