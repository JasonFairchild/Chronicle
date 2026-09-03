# Chronicle — Claude Code Instructions

## What this project is

Local-first PWA life-mapping / journaling app. Portfolio demo + personal tool.
Every record is a unified immutable `Entry`. Updates, annotations, and connections are also Entries (recursive). Roots have no parent.

Goals while coding:

- Primarily a portfolio demo for employers: favor clear, readable, easy-to-explain code
- Keep the product and code simple
- Local-first / offline is non-negotiable
- Immutability + reconstructible history is a core feature
- When equally good options exist, prefer the one that uses less context / fewer steps

## Tech stack

Vue 3 + TypeScript + Vite, Tailwind (dark-mode ready), Pinia, Vue Router,  
SQLite WASM + OPFS (preferred) or Dexie, TipTap (from Phase 1), vite-plugin-pwa.  
Tests required every phase: Vitest (unit + Browser Mode) + Cypress Component Testing.

**Testing note:** Vitest Browser Mode + Cypress CT run side by side on purpose (tool
comparison). Duplicate component tests are intentional — don't consolidate. Split:
`*.test.ts` = pure logic (node); `*.browser.test.ts` = Vitest browser; `*.cy.ts` = Cypress.

## Data model (entries)

- id (UUID), created_at (immutable, system-set), recorded_at?, occurred_at? (both nullable, user-supplied), parent_id, relation_type (`annotation` | `connection` | `update` | null), target_id, type (`text` | `image` | …), content, media_refs, metadata
- Relation types: `update` = explicit user-facing milestone about a parent; `annotation` = a note/comment on an entry; `connection` = user-authored link between two entries (`parent_id` + `target_id`). Full rationale in CHRONICLE_PLAN.md.
- `update` is NOT for typo/minor fixes — that's the future "smarter edit" mode (see plan).

**Write rule:** Prefer INSERT of new related Entries. Do not mutate existing rows for “edits.”

Reconstructing aggregated current state or state-at-time-T must stay easy via the repository + pure `reconstructEntryState`.

## Current priority (Phase 1 → Phase 2)

Phase 0 scaffold is done (scaffold, PWA shell, Vitest + Cypress CT, in-memory repo, text entry + timeline, tests). Next:

1. Persistent Entry repository adapter (SQLite WASM + OPFS; Dexie fallback) behind the existing `EntryRepository` interface
2. Wire the store to the persistent adapter; verify data survives an offline reload
3. Per-entry aggregated detail view + creating child entries (annotation / update / connection)
4. Give `update` vs `annotation` distinct behavior in `reconstructEntryState` (currently identical)
5. Image entries (media_refs + OPFS blob storage)
6. Tests alongside each of the above

## Hard rules

- Tests alongside every feature
- Composition API + `<script setup>`
- All data access behind repository/service layer
- Prefer append (new Entries) over mutation
- No hard-coded colors that block dark mode
- Small, focused changes
- Prefer one shell command over a pipeline. Every binary in a chain must be
  allowlisted, so a stray `| sed` or `; echo` triggers a permission prompt.
  Use Read/Grep/Glob instead of `cat`/`grep`/`find` pipelines.

## Out of scope for now

Smarter multi-edit sessions, automatic snapshots, fine-grained change tracking, graph view, video, Tauri, sync, encryption.
