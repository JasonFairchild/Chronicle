# Chronicle

Local-first Progressive Web App for personal life mapping and journaling. Every record is an immutable **Entry**; updates, annotations, and connections are modeled as related entries rather than in-place edits.

## Architecture

```
Views / Components → Pinia store → EntryRepository (interface)
                                          ↑
                            src/repositories/index.ts  ← the only file naming a concrete adapter
                                          ↓
                      DexieEntryRepository (active) | InMemoryEntryRepository (tests)
                                          ↳ SQLite WASM + OPFS (planned)
```

Storage sits behind one interface, and a single composition root decides which adapter implements
it. Nothing in the store, views, or domain layer names a concrete adapter, so changing backends is
a one-line change. Both adapters run the same behavioral suite from `entryRepository.contract.ts`,
which is what makes that swap trustworthy rather than merely claimed.

Core domain logic lives in `reconstructEntryState`, which folds an entry's version chain to get its
state at any moment and returns its children and connections as separate collections rather than
splicing them into the text. Anchor resolution is a second pure module: it locates a child entry's
references as marks and nodes inside the parent's current document, reading it as `present` or
`orphaned` rather than vanishing when an edit removes one.

See [ENTRY_MODEL.md](./ENTRY_MODEL.md) for the data model and the reasoning behind it, including why
ids are UUIDv7, why only revisions write content, and why connections are edges rather than children.

## Tech stack

- Vue 3 + TypeScript + Vite
- Tailwind CSS (class-based dark mode ready via CSS variables)
- Pinia + Vue Router
- vite-plugin-pwa (offline shell)
- Vitest (unit + browser mode) and Cypress component testing

## Getting started

```bash
npm install
npx playwright install chromium   # first-time setup for Vitest browser tests
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Start Vite dev server                       |
| `npm run build`        | Type-check and production build             |
| `npm run preview`      | Preview production build                    |
| `npm run test`         | Vitest unit project                         |
| `npm run test:browser` | Vitest browser project                      |
| `npm run test:watch`   | Vitest unit project in watch mode           |
| `npm run cy`           | Cypress component test runner (interactive) |
| `npm run cy:run`       | Cypress component tests (headless)          |
| `npm run typecheck`    | Type-check all project references (vue-tsc) |
| `npm run lint`         | ESLint                                      |
| `npm run lint:fix`     | ESLint with autofix                         |
| `npm run format`       | Prettier write                              |
| `npm run format:check` | Prettier check (no writes)                  |
| `npm run verify`       | typecheck + lint + format:check             |

## Git hooks

[Lefthook](https://lefthook.dev) is installed via the `prepare` script. On **pre-commit** it
auto-formats staged files with Prettier (and re-stages them), lint-checks and type-checks, and
aborts the commit on any failure. ESLint runs **check-only** here — fix findings with
`npm run lint:fix` and review the changes yourself. On **pre-push** it runs the unit tests.
Skip with `LEFTHOOK=0 git commit …` when needed.

## Roadmap

See [PRODUCT.md](./PRODUCT.md) for how the app behaves from a user's perspective,
[CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md) for the product concept and phased plan,
[ENTRY_MODEL.md](./ENTRY_MODEL.md) for the entry model, and [TESTING.md](./TESTING.md) for how
tests are written.
