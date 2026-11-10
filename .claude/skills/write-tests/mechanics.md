# Test mechanics

How-to that TESTING.md's rules leave to the writer: where the two runners differ, and setup details that have bitten before. Notes toward a Vitest Browser Mode vs Cypress write-up, too.

## Where the runners differ

- **Retrying.** `vi.waitFor` retries an async block, repository reads included. Cypress retries queries and `.should`, but not a `cy.then` callback. So to wait on a write no UI shows, outside a let-go session, Vitest retries the read; Cypress aliases a spy on the repository method, waits on `should('have.been.called')`, then on the call's returned promise.
- **Spies.** `vi.spyOn` and `cy.spy` both work on a Pinia store's actions after mounting. Each exposes the call's returned promise: `mock.results[0].value` / `firstCall.returnValue`.
- **Seeding.** Inline `await` in Vitest; one `cy.then(async …)` yielding what the test uses in Cypress, not nested chains.
- **Exact text.** `toHaveTextContent` is partial; `have.text` is exact, down to the space Vue keeps around static template text (it trims around `{{ }}`), so static text takes `contain.text`. Vitest's exact form is a locator intersection asserted visible: `getByRole('alert').and(getByText(text, { exact: true }))`.
- **Another tab.** A second Pinia over the same database. In Cypress, set it active in a `cy.then` before `cy.mount`, which installs its own. Returning to the tab is `focus` on `window` (`cy.window()` in Cypress).
- **Enter on a button.** `cy.press(Enter)` doesn't activate a focused button; click it instead.
- **Real input.** Vitest's `userEvent` goes through Playwright as trusted browser input; Cypress's `click` and `type` are synthesized in the page, so the browser's own handling doesn't run: a click puts the caret at the element's end, not where it lands. Reach for `cypress-real-events` (`realClick({ x, y })`, as `DocumentEditor.cy.ts` does) only where a test needs that handling and Cypress's own commands can't give it.
- **Component internals.** `cy.mount` yields the Vue Test Utils wrapper (`findComponent`, `props`, `setProps`); `vitest-browser-vue`'s `render` exposes only `rerender` and `emitted`.

## Setup

- **Import test helpers by alias** (`@/testing/…`), setup files included. A relative path loads a second copy of the module: `browserSetup.ts` once disposed a list no spec had added to, and no database was deleted.
- **A persistence test cleans up after itself.** The adapter specs' persistence tests open storage under a name of their own, to reopen it, so the global hook never sees it. Delete it by name with `onTestFinished` where it's created, not at the end of the body, where a failed assertion skips it.
- **Read a router's address before unmounting the app.** When its last app unmounts, vue-router returns it to `/`, so a reload simulated by remounting at `currentRoute.fullPath` lands at the start instead.
- **Don't put the caret at an editor's start just as it gains focus.** Within 200ms of a focus event, with no click in the last 300ms, ProseMirror takes a collapsed selection at the document's start for the browser resetting it, and restores its own (`prosemirror-view`'s `domobserver.ts`). So `selectTextRange(el, 0, 0)` right after focusing an unfocused editor is undone, silently; do it while the editor already has focus, where `focus()` fires no event.
- **In node, a write a fake timer starts can still be in flight when `vi.advanceTimersByTimeAsync` returns:** fake-indexeddb runs on real `setImmediate`. Spy on the repository call, assert it was made, and await `mock.results[n].value` before reading back.
- **Fail a write by stubbing the `@/repositories` binding before mounting** — `cy.stub(draftRepository, 'seal').rejects(…)`, `vi.spyOn(…).mockRejectedValue(…)`. The global `beforeEach` has already put that test's instance there.
