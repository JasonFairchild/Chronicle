# Test mechanics

How-to that TESTING.md's rules leave to the writer: where the two runners differ, and setup details that have bitten before. Notes toward a Vitest Browser Mode vs Cypress write-up, too.

## Where the runners differ

- **Retrying.** `vi.waitFor` retries an async block, repository reads included. Cypress retries queries and `.should`, but not a `cy.then` callback. So to wait on a write no UI shows, outside a let-go session, Vitest retries the read; Cypress aliases a spy on the repository method, waits on `should('have.been.called')`, then on the call's returned promise.
- **Spies.** `vi.spyOn` and `cy.spy` both work on a Pinia store's actions after mounting. Each exposes the call's returned promise: `mock.results[0].value` / `firstCall.returnValue`.
- **Seeding.** Inline `await` in Vitest; one `cy.then(async …)` yielding what the test uses in Cypress, not nested chains.
- **Exact text.** `toHaveTextContent` is partial; `have.text` is exact, down to the space Vue keeps around static template text (it trims around `{{ }}`), so static text takes `contain.text`. Vitest's exact form is a locator intersection asserted visible: `getByRole('alert').and(getByText(text, { exact: true }))`.
- **Another tab.** A second Pinia over the same database. In Cypress, set it active in a `cy.then` before `cy.mount`, which installs its own. Returning to the tab is `focus` on `window` (`cy.window()` in Cypress).
- **Component internals.** `cy.mount` yields the Vue Test Utils wrapper (`findComponent`, `props`, `setProps`); `vitest-browser-vue`'s `render` exposes only `rerender` and `emitted`.

## Setup

- **Import test helpers by alias** (`@/testing/…`), setup files included. A relative path loads a second copy of the module: `browserSetup.ts` once disposed a list no spec had added to, and no database was deleted.
- **A persistence test cleans up after itself.** The adapter specs' persistence tests open storage under a name of their own, to reopen it, so the global hook never sees it. Delete it by name with `onTestFinished` where it's created, not at the end of the body, where a failed assertion skips it.
- **Read a router's address before unmounting the app.** When its last app unmounts, vue-router returns it to `/`, so a reload simulated by remounting at `currentRoute.fullPath` lands at the start instead.
- **Fail a write by stubbing the `@/repositories` binding before mounting** — `cy.stub(entryRepository, 'create').rejects(…)`, `vi.spyOn(…).mockRejectedValue(…)`. The global `beforeEach` has already put that test's instance there.

## Waiting on the editor

A disabled editor shows its title as text, so "no Title textbox" passes the moment a save starts. To wait for a save to finish, wait on the body textbox closing or emptying.
