# Chronicle — Claude Code Instructions

Local-first PWA life-mapping / journaling app. First a portfolio piece showing web engineering to
employers, second a personal tool — so a PWA and a TypeScript project before anything else. Each
addition should show solid engineering without overcomplicating the product or the code.

Every record is one immutable `Entry`; updates, annotations, connections, and revisions are Entries
too. Offline is non-negotiable. Immutability and reconstructible history — current state or state
at time T, via the repository plus the pure `reconstructEntryState` — are core features.

Stack: Vue 3 + TypeScript + Vite, Tailwind, Pinia, Vue Router, TipTap, vite-plugin-pwa, Dexie
(SQLite WASM + OPFS later), Vitest (unit + Browser Mode), Cypress CT.

## One command per call. No pipelines.

The rule most often broken. A permission rule matches the **whole** command string, so every `|`,
`&&` and `;` makes an unlisted compound that prompts: `Bash(npm run:*)` doesn't cover
`npm run test:browser 2>&1 | tail -20`. Run one command and read all of its output; two things to
run is two calls. Prefer Read, Grep and Glob to the shell — they never prompt.

## Other docs — list headings, then read the sections that cover your change

| Doc               | Authority on                            | Read before changing                                                     |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| ENTRY_MODEL.md    | entries, anchors, versions, connections | `src/types/entry.ts`, `src/domain/`, `src/repositories/`                 |
| AUTHORING.md      | capture, marks, mark sets, drafts       | `authoringSession`, `marks`, `editor/replay`, `markFrames`, draft stores |
| TESTING.md        | how tests are written                   | any test                                                                 |
| PRODUCT.md        | behavior: built, decided, maybe         | anything user-visible                                                    |
| CHRONICLE_PLAN.md | priorities and decided engineering work | planning or scoping work                                                 |

## Rules

- **Write rule:** INSERT new related Entries; never mutate rows for "edits". Two exceptions, neither
  of them history: draft rows (`draftsStore.ts`) are overwritten as working space, and mark sets
  (`markSetsStore.ts`) may be deleted, as a cache rebuildable from the trace.
- **No child entry is destructive.** Only a `revision` writes content.
- **Sort entries with `compareEntries`, never `created_at` alone** — it ties at millisecond resolution.
- Tests alongside every feature.
- Composition API + `<script setup>`; all data access behind the repository layer.
- No hard-coded colors that block dark mode.
- Small, focused changes I can read and explain.
- **Comments cite nothing that outlives the session** — no plan, chat, or "Piece N"; cite a
  checked-in doc or nothing. The non-obvious why, stated once, proportional to the code it sits
  next to — not a walkthrough.
- **Comment style marks scope, not length.** `/** */` heads a unit (file, function — nested ones
  too — type, class), even at one line. `//` covers a few lines within a unit, even at several
  lines. A short note on one field or statement is a trailing `//` on that line, moved above only
  if it won't fit. Going forward only; fix old comments opportunistically, not in a sweep.
- Between equally good options, take the one that costs less context.
- Commit messages: a subject line, then only what the diff can't say — why, and what a reviewer
  couldn't discover from the code. No tour of the changes.
- **Draft commits, don't run them.** Staging and `git commit` are mine, every time; don't stage
  unless asked directly.
- **No backward compatibility until we deliberately decide it's needed** — including entries in a
  browser's IndexedDB, which is all test data for now. Change a shape and update every call site,
  with no fallback for the old one. If old local data breaks, clear IndexedDB or reseed; don't
  migrate or tolerate it.

## Landmarks

- `src/domain/entryDocument.ts` — the **only** flattening. Anchors, previews, search, and diff all
  measure against `docToPlainText`, or an anchor recorded on one ruler resolves on another.
  Mark-set frame highlights are deliberately off it (AUTHORING.md, "Mark sets").
- `src/editor/` — schema and the guarded, anchor-aware document commands live only in
  `extensions.ts` and `anchorCommands.ts`; a second definition or a hand-rolled transaction silently
  breaks "no child entry is destructive" or anchor-mode exclusivity. A component holding an `Editor`
  to mount it or drive TipTap UI (`DocumentEditor.vue`, `AnchorMenu.vue`) is fine. The domain layer
  reads documents as plain JSON, which keeps it node-testable.
- `src/repositories/index.ts` — the composition root. Four interfaces, each with an in-memory
  adapter (tests) and a persistent one (app), each proven by a shared `.contract.ts`.
