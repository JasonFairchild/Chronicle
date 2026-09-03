# Project Chronicle: Local-First Life Mapping / Journaling App (MVP)

## Core Concept

This project primarily demonstrates web development skills for potential employers, while also serving personal life-record needs. It is therefore first a PWA and a TypeScript/JavaScript project.

When adding to the project, consistently consider how the work can demonstrate solid engineering without overly complicating the product or the code.

Every record is a unified `Entry` object. Updates, annotations, and connections are themselves full Entries that can be further annotated or updated (recursive hierarchy). Root entries simply have no parent.

This model supports:

- An aggregated “current state” view of an entry (related updates applied or shown together).
- A scrubbable per-entry history timeline (each step shows the entry as it existed at that moment).
- Global Timeline and Graph/Connection views.

## Key Product Rules

- Entries are treated as immutable at the core. Changes are modeled by inserting related Entries (or, later, snapshot mechanisms)—not by mutating existing rows.
- Fully local data; works offline; no backend or account required.
- Start with text + images.
- Light/dark theme support should not be blocked by early architectural choices (use CSS variables / Tailwind dark mode from the start), but it is low priority for the first milestones.

## Tech Stack

- Vue 3 + TypeScript + Vite
- Tailwind CSS (dark mode class strategy ready)
- Pinia
- Vue Router
- Local DB: SQLite via `@sqlite.org/sqlite-wasm` + OPFS (preferred) or Dexie.js as fallback
- Rich text: TipTap (Phase 1; plain text is fine in Phase 0)
- PWA: vite-plugin-pwa
- Testing (required in every phase):
  - Vitest (unit + Browser Mode)
  - Cypress Component Testing
  - Note: using both Vitest Browser Mode and Cypress CT together is an intentional
    tool-comparison experiment. The author is experienced with Cypress and wants to
    learn Vitest's browser/component story in depth. Duplicated component tests across
    the two runners are expected and fine for the foreseeable future; revisit only once
    the comparison has served its purpose. Split convention:
    - `*.test.ts` — pure logic, `node` environment, no DOM
    - `*.browser.test.ts` — Vitest Browser Mode (real Chromium via Playwright)
    - `*.cy.ts` — Cypress Component Testing
- Later candidates: Vue Flow (graph), virtualization helpers

## Data Model (Unified & Extensible)

`entries` table / collection:

- `id` (UUID)
- `created_at` (high-precision, immutable) — when the entry was added to Chronicle; system-set
- `recorded_at` (nullable) — when the record was originally recorded elsewhere; null if authored directly in-app
- `occurred_at` (nullable) — when the event being recorded actually happened, if known
- `parent_id` (nullable) — the entry this one relates to
- `relation_type` (nullable) — `annotation` | `connection` | `update` (roots are null)
- `target_id` (nullable) — used for `connection` relations
- `type` — `text` | `image` | …
- `content`
- `media_refs`
- `metadata` (JSON)

The three dates are deliberately separate: `created_at` anchors the immutable ledger, while `recorded_at` / `occurred_at` are user-supplied and let the timeline be ordered by when things _happened_ rather than when they were entered.

### Relation types

- **`update`** — an explicit, first-class entry about a parent entry ("here's what changed / what happened next"). Users can expound on an update at length. The point is to make updates visible and to visualize many updates to one entry over time. This is _not_ the mechanism for fixing typos or minor revisions (see "smarter edit" below).
- **`annotation`** — a comment or note on an existing entry. Lightweight; does not claim anything changed.
- **`connection`** — a user-created link between two entries (`parent_id` + `target_id`), carrying the user's thoughts about why the two relate.

**Write rule:** Prefer insert over update. New related Entries are created instead of mutating existing ones.

Reconstructing aggregated current state or historical state at time T must stay straightforward via the repository layer (and pure helpers such as `reconstructEntryState`).

## First Tasks (Phase 0 — status)

1. [x] Scaffold Vite + Vue 3 + TypeScript + Tailwind + Vue Router + Pinia.
2. [x] Configure vite-plugin-pwa and a basic offline shell.
3. [x] Set up both Vitest (including Browser Mode) and Cypress Component Testing.
4. Implement the Entry repository:
   - 4a) [x] Interface + in-memory adapter (with `parent_id`, `relation_type`, `target_id`)
   - 4b) [ ] Persistent adapter (SQLite WASM preferred, or Dexie)
5. [x] Minimal layout + create a text entry + list entries in a basic timeline.
6. [x] First data-layer and component tests (repository, store, `reconstructEntryState`, `EntryForm`).

## Phased MVP

**Phase 0 – Skeleton + Testing Foundation**  
Project setup, DB/repository layer, basic layout, testing infrastructure.

**Phase 1 – Core Entries + Global Timeline**  
Create text + image entries, global timeline view, basic aggregated entry detail.

**Phase 2 – Hierarchy & Relations**  
Create child entries (annotations, updates, connections), parent/child navigation, improved aggregated current-state view.

**Phase 3 – Per-Entry History Timeline**  
Scrubbable history view for a single entry; each step shows the entry in the state it had at that moment. Keep visual language consistent with the global timeline.

**Phase 4 – Graph View + Polish**  
Connection/graph visualization, search/filtering, export/backup, PWA install experience, broader test coverage.

## Future Considerations (explicitly out of MVP)

- Smarter “edit” experience: a mode that “opens up” any entry (roots included) for editing while tracking those edits over time — the detailed _evolution of an entry_ — without cluttering the UI with a separate Entry per minor change. This is distinct from `update` relations, which are deliberate, user-facing milestones. Editing may be deferred until this is clearer.
- Automatic or semi-automatic snapshots when enough content has changed or enough time has passed; these feed the per-entry history and longer-term “evolution over time.”
- Finer-grained (but not keystroke-level) change tracking — the persistence layer behind the “smarter edit” mode above.
- Light/dark theme polish and preference persistence.
- Video/audio support, optional Tauri desktop shell, encryption, multi-device sync.

## Implementation Rules for the AI

- Testing is non-negotiable in every phase — write tests alongside features.
- Prefer Composition API + `<script setup>`.
- Keep all data access behind a clean repository/service layer.
- Core domain logic: `reconstructEntryState` (pure function) rebuilds aggregated or historical entry state from related entries.
- Design so historical reconstruction and aggregated views remain easy.
- Prefer appending new Entries over mutating existing ones.
- Do not hard-code colors or styles in a way that makes dark mode painful later.
- Small, focused commits.
