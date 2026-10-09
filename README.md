# Chronicle

Local-first Progressive Web App for personal life mapping and journaling. Every record is an immutable **Entry**; revisions, updates, annotations, and connections are modeled as related entries rather than in-place edits.

## Architecture

[ARCHITECTURE.md](./ARCHITECTURE.md) is the whole app on one page: each layer, and how data moves between them.

Storage sits behind four repository interfaces — entries, drafts, mark sets, media — and a single composition root (`src/repositories/index.ts`) decides which adapter implements each. Nothing in the stores, views, or domain layer names a concrete adapter, so changing a backend is a one-line change. Each interface has an in-memory adapter for tests and a persistent one for the app (Dexie, or OPFS for media), and both run the same behavioral suite from its `.contract.ts`, which is what makes that swap trustworthy rather than merely claimed.

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

Tests are written from the user's perspective: they simulate real interaction and assert what a user can see. Every spec runs real stores over real repositories on an isolated database. A component spec is one screen: storage is seeded beneath it and never read back. A flow spec (`.flow.`) mounts the app at a route and follows one path from the click down to what's stored, across as many screens as it takes. Unit tests cover only what the UI can't reach — many-case pure logic, timing and races, fault injection — and each repository's contract suite holds every adapter to the same behavior.

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

| Command                     | Description                                 |
| --------------------------- | ------------------------------------------- |
| `npm run dev`               | Start Vite dev server                       |
| `npm run build`             | Type-check and production build             |
| `npm run preview`           | Preview production build                    |
| `npm run test`              | Vitest unit project                         |
| `npm run test:browser`      | Vitest browser project                      |
| `npm run test:browser:open` | Vitest browser project, headed              |
| `npm run test:watch`        | Vitest unit project in watch mode           |
| `npm run test:coverage`     | Both Vitest projects with coverage          |
| `npm run cy`                | Cypress component test runner (interactive) |
| `npm run cy:run`            | Cypress component tests (headless)          |
| `npm run typecheck`         | Type-check all project references (vue-tsc) |
| `npm run lint`              | ESLint                                      |
| `npm run lint:fix`          | ESLint with autofix                         |
| `npm run format`            | Prettier write                              |
| `npm run format:check`      | Prettier check (no writes)                  |
| `npm run verify`            | typecheck + lint + format:check             |

## Git hooks

[Lefthook](https://lefthook.dev) is installed via the `prepare` script. On **pre-commit** it auto-formats staged files with Prettier (and re-stages them), lint-checks and type-checks, and runs the unit tests, and aborts the commit on any failure. ESLint runs **check-only** here — fix findings with `npm run lint:fix` and review the changes yourself. On **pre-push** it runs the Vitest browser tests and then Cypress. Skip with `LEFTHOOK=0 git commit …` when needed.

## Roadmap

See [PRODUCT.md](./PRODUCT.md) for how the app behaves and what's decided next, and [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md) for priorities.
