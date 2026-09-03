# Chronicle

Local-first Progressive Web App for personal life mapping and journaling. Every record is an immutable **Entry**; updates, annotations, and connections are modeled as related entries rather than in-place edits.

## Architecture

```
Views / Components → Pinia store → EntryRepository (interface) → InMemoryEntryRepository
                                                              ↳ SQLite / Dexie (future)
```

Core domain logic lives in `reconstructEntryState`, which rebuilds an entry's aggregated content from its root entry and related child entries ordered by `created_at`.

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

See [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md) for the product concept, data model, and phased plan.
