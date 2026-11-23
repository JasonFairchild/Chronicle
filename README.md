# Chronicle

Local-first Progressive Web App for personal life mapping and journaling. Every record is an immutable **Entry**; revisions, updates, annotations, and connections are modeled as related entries rather than in-place edits.

## Architecture

[ARCHITECTURE.md](./ARCHITECTURE.md) is the whole app on one page: each layer, and how data moves between them.

Storage sits behind four repository interfaces — entries, drafts, mark sets, media — and a single composition root (`src/repositories/index.ts`) decides which adapter implements each. Nothing in the stores, views, or domain layer names a concrete adapter, so changing a backend is a one-line change. Each interface has one adapter today (Dexie, or OPFS for media), and tests run it rather than a stand-in: node specs run Dexie on `fake-indexeddb`. Entries and drafts, the two a SQLite backend is planned for, each have a `.contract.ts`: the behavioral suite the replacement must pass, which is what makes that swap trustworthy rather than merely claimed.

Nothing is stored in the form it's viewed in. Entries are append-only, and `reconstructEntryState` folds an entry's revisions into its state now or at any earlier moment, alongside the entries related to it. A writing session is recorded as ProseMirror steps — an event log that replays to the saved content exactly — and the points worth stopping at in its history are derived from that log under a tunable policy, cached as deletable mark sets rather than stored with it. The domain layer reads documents as plain JSON, so this logic is pure and testable in node.

[ENTRY_MODEL.md](./ENTRY_MODEL.md) covers the data model and the reasoning behind it; [AUTHORING.md](./AUTHORING.md) covers how writing is captured, drafted, and read back.

## Tech stack

- Vue 3 + TypeScript + Vite
- TipTap 3 on ProseMirror (the editor; its steps are the authoring trace)
- Tailwind CSS (class-based dark mode ready via CSS variables)
- Pinia + Vue Router
- Dexie over IndexedDB, and OPFS for media (SQLite WASM + OPFS planned)
- vite-plugin-pwa (offline shell)
- Vitest (unit + Browser Mode on Playwright) and Cypress component testing (with Testing Library)

## Testing

Tests are written from the user's perspective: they simulate real interaction and assert what a user can see. Every spec runs real stores over real repositories on an isolated database. A component spec is one screen: storage is seeded beneath it and never read back. A flow spec (`.flow.`) mounts the app at a route and follows one path from the click down to what's stored, across as many screens as it takes. Unit tests cover only what the UI can't reach — many-case pure logic, timing and races, fault injection — and the entry and draft contract suites hold their adapters, and the SQLite ones to come, to the same behavior.

Component and flow specs run in both Vitest Browser Mode and Cypress, deliberately duplicated to compare the two runners on the same cases.

[TESTING.md](./TESTING.md) has the full guidelines.

## Getting started

```bash
npm install
npx playwright install chromium   # first-time setup for Vitest browser tests
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

### Most used

| Command          | Description                                 |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | Start Vite dev server                       |
| `npm run cy:run` | Cypress component tests (headless)          |
| `npm run cy`     | Cypress component test runner (interactive) |
| `npm run cy:par` | Cypress component tests, 2 in parallel      |
| `npm run verify` | typecheck, lint, format, unused, citations  |

### Vitest

| Command                     | Description                 |
| --------------------------- | --------------------------- |
| `npm run test`              | Unit project                |
| `npm run test:watch`        | Unit project in watch mode  |
| `npm run test:browser`      | Browser project             |
| `npm run test:browser:open` | Browser project, headed     |
| `npm run test:coverage`     | Both projects with coverage |

### Checks, each in `verify`, and their fixers

| Command                | Description                                   |
| ---------------------- | --------------------------------------------- |
| `npm run typecheck`    | Type-check all project references (vue-tsc)   |
| `npm run lint`         | ESLint                                        |
| `npm run lint:fix`     | ESLint with autofix                           |
| `npm run format:check` | Prettier check (no writes)                    |
| `npm run format`       | Prettier write                                |
| `npm run unused`       | Unused files, exports and dependencies (knip) |
| `npm run citations`    | Every citation between docs and code resolves |

### Tools the agent and hooks run

| Command                   | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `npm run cite -- '<ref>'` | Print the section or rule a citation names           |
| `npm run comments`        | List the comments uncommitted work adds or changes   |
| `npm run diagram`         | Render ARCHITECTURE.md's diagram to check its layout |
| `npm run drive`           | Start the app, run a flow in Chromium, stop both     |
| `npm run hover:package`   | Package the citation hover for VS Code               |

### Build

| Command           | Description                     |
| ----------------- | ------------------------------- |
| `npm run build`   | Type-check and production build |
| `npm run preview` | Preview production build        |

To run only the flow specs: `npm run cy:run -- --spec "src/**/*.flow.cy.ts"`, or `npm run test:browser -- .flow.`

`cy`, `cy:run` and `hover:package` clear environment variables with cmd.exe's `set X=&&`, so they run only on Windows; elsewhere, run the same command with those variables unset.

The citation hover (`tools/citation-hover/`) shows what a citation cites in VS Code, and on a cited heading or rule, what cites it. Install it with `npm run hover:package`, then in VS Code's Extensions tab, near the top, click **…** ("Views and More Actions...") › **Install from VSIX…** on `node_modules/.tmp/citation-hover.vsix`. It runs the repo's own resolver, so a change there needs only **Developer: Reload Window**; a change to the extension needs packaging again.

## Git hooks

[Lefthook](https://lefthook.dev) is installed via the `prepare` script. On **pre-commit** it auto-formats staged files with Prettier (and re-stages them), lint-checks and type-checks, runs the unit tests, the unused-code check (knip) and the citation check, and aborts the commit on any failure. ESLint runs **check-only** here — fix findings with `npm run lint:fix` and review the changes yourself. On **pre-push** it runs the Vitest browser tests and then Cypress. Skip with `LEFTHOOK=0 git commit …` when needed.

## Roadmap

See [PRODUCT.md](./PRODUCT.md) for how the app behaves and what's decided next, and [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md) for priorities.
