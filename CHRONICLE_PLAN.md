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

**See [ENTRY_MODEL.md](./ENTRY_MODEL.md) for the authoritative model and the reasoning behind it.**
What follows is an orientation, not a specification.

`entries` table / collection:

- `id` (UUIDv7) — time-ordered, so it breaks `created_at` ties and gives history a total order
- `created_at` (immutable) — when the entry was added to Chronicle; system-set
- `recorded_at` (nullable) — when the record was originally recorded elsewhere; null if authored directly in-app
- `occurred_at` (nullable) — when the event being recorded actually happened, if known
- `parent_id` (nullable) — the entry this one is attached to; containment follows this and only this
- `relation_type` (nullable) — `annotation` | `update` | `connection` | `revision` (roots are null)
- `target_id` (nullable) — the far endpoint of a `connection`
- `title` (nullable) — cache of the document's title node
- `content` — serialized document
- `anchors` — the places in the parent this entry operates on; empty means "the parent at large"
- `authoring_trace` (nullable) — how this snapshot was typed
- `media_refs`
- `metadata` (JSON)

The three dates are deliberately separate: `created_at` anchors the immutable ledger, while `recorded_at` / `occurred_at` are user-supplied and let the timeline be ordered by when things _happened_ rather than when they were entered. A bulk import shares one `created_at` by design; `occurred_at` is what such entries get sorted by.

### Relation types

Only two of these change how the domain layer behaves. The other two are a label.

- **`revision`** — a new version of the entry itself, and the _only_ relation that writes content. Full-state snapshot, last one wins. This is the mechanism behind "smarter edit" and behind capturing how a first draft was written.
- **`connection`** — a directional edge between two entries (`parent_id` = source, `target_id` = destination), carrying the user's thoughts about why they relate. Gathered onto both endpoints, but never traversed as containment.
- **`update`** — a child entry that reports what changed or happened next, usually anchored to a specific passage. Updates accumulate and are visualized over time; they never overwrite the parent.
- **`annotation`** — a note on an entry or on a passage within it. Does not claim anything changed.

The update/annotation split is a label for UI and filtering. Structurally both are children carrying anchored operations, and what the user actually did — striking a phrase, inserting wording, or just commenting — is what distinguishes them.

**Write rule:** Prefer insert over update. New related Entries are created instead of mutating existing ones. No child entry is ever destructive: a parent's stored text is never altered by its children.

Reconstructing aggregated current state or historical state at time T must stay straightforward via the repository layer (and pure helpers such as `reconstructEntryState`).

## First Tasks (Phase 0 — status)

1. [x] Scaffold Vite + Vue 3 + TypeScript + Tailwind + Vue Router + Pinia.
2. [x] Configure vite-plugin-pwa and a basic offline shell.
3. [x] Set up both Vitest (including Browser Mode) and Cypress Component Testing.
4. Implement the Entry repository:
   - 4a) [x] Interface + in-memory adapter (with `parent_id`, `relation_type`, `target_id`)
   - 4b) [x] Persistent adapter — Dexie, wired at the composition root and proven against the same
     contract suite as the in-memory one. SQLite WASM + OPFS remains the preferred long-term
     backend and is deliberately deferred until the Dexie path has been used in anger.
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

The “smarter edit” experience is no longer an open question — it is designed in
[ENTRY_MODEL.md](./ENTRY_MODEL.md) as the `revision` relation plus authoring capture, and it is
Phase 2 work rather than a someday item. An entry becomes a living chain: opening it for editing
reopens that chain and appends to it, the latest state is what most views surface, and nothing
important is lost. Ticks bookmark meaningful moments in a session without becoming entries.

The capture layer now exists: sessions accumulate ProseMirror steps into a durable draft buffer,
ticks bookmark the moments worth returning to, and sealing writes one immutable entry carrying the
completed trace. Diff rendering and the scrubbable history UI are unblocked by it and are Phase 3.

Still genuinely out of scope:

- Diff rendering and the scrubbable per-entry history UI, now unblocked but not yet built.
- Warning before a revision orphans a child's anchor.
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
