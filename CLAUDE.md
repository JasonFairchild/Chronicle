# Chronicle — Claude Code Instructions

Local-first PWA life-mapping / journaling app; portfolio demo + personal tool. Every record is one
immutable `Entry` — updates, annotations, connections, and revisions are Entries too. Offline is
non-negotiable; immutability and reconstructible history are the core feature, not a nicety.

Stack: Vue 3 + TypeScript + Vite, Tailwind (dark-mode ready), Pinia, Vue Router, TipTap,
vite-plugin-pwa, Dexie today / SQLite WASM + OPFS later, Vitest (unit + Browser Mode) + Cypress CT.

## The other docs — read the relevant one before changing that area

| Doc               | Authority on                        | Read before                                              |
| ----------------- | ----------------------------------- | -------------------------------------------------------- |
| ENTRY_MODEL.md    | the data model and its reasoning    | `src/types/entry.ts`, `src/domain/`, `src/repositories/` |
| TESTING.md        | how tests are written               | writing or changing any test                             |
| PRODUCT.md        | behavior, and what is built vs next | changing anything user-visible                           |
| CHRONICLE_PLAN.md | phases and what is out of scope     | planning or scoping work                                 |

## Rules that always apply

- **Write rule:** prefer INSERT of new related Entries; never mutate rows for "edits". The draft
  buffer (`src/stores/draftsStore.ts`) really does overwrite rows and is the one sanctioned
  exception — working space, not history.
- **No child entry is destructive.** Only a `revision` writes content.
- **Ordering:** every sort tiebreaks on `id` via `compareEntries`; `created_at` is only
  millisecond-resolution and so is not a total order on its own.
- Reconstructing aggregated current state or state-at-time-T stays easy via the repository plus the
  pure `reconstructEntryState`.
- Tests alongside every feature. `*.test.ts` = pure logic (node), `*.browser.test.ts` = Vitest
  browser, `*.cy.ts` = Cypress, `*.contract.ts` = shared suite, never run directly.
- Composition API + `<script setup>`; all data access behind the repository layer.
- No hard-coded colors that block dark mode.
- Small, focused changes, in code an employer can read and I can explain.
- When two options are equally good, take the one that costs less context.
- Prefer one shell command over a pipeline. Every binary in a chain must be allowlisted, so a stray
  `| sed` or `; echo` triggers a permission prompt. Use Read/Grep/Glob, not `cat`/`grep`/`find`.

## Landmarks

- `src/domain/entryDocument.ts` — the **only** flattening. Anchors, previews, search, and diff must
  all measure against `docToPlainText`, or an anchor recorded on one ruler resolves on another.
- `src/editor/extensions.ts` — the only module that knows TipTap exists. The domain layer reads
  documents as plain JSON, which is what keeps it pure and node-testable.
- `src/repositories/index.ts` — the composition root. Three interfaces, each with an in-memory
  adapter for tests and a persistent one for the app, each proven by a shared `.contract.ts`.

## Where the work is

Phase 2 is feature-complete and covered by tests; PRODUCT.md §4 is the list of what that means.
Next: the SQLite WASM + OPFS adapter behind `EntryRepository` / `DraftRepository`, deliberately
deferred until the Dexie path has been used in anger. Then Phase 3 — scrubbable per-entry history,
revision diffs, and the orphaned-anchor warning (PRODUCT.md §5).
