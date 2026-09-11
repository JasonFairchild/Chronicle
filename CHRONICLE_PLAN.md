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
- Light/dark theme polish and preference persistence.
- Video/audio support, optional Tauri desktop shell, encryption, multi-device sync.

**The anchor model redesign is built (2026-09-11).** Anchors moved from offsets stored on a child
entry into marks and nodes inside the parent's own document — see ENTRY_MODEL.md, "Child entries and
anchors" and "Two creation experiences, kept separate." `resolveAnchor.ts`'s four-status ladder and
`ChildEntryForm`'s old quote/opKind API are gone; anchor-mode child creation
(`DocumentEditor.vue`'s `anchor-mode` prop, `EntryRepository.createMany` for the atomic
parent-revision-plus-child seal) and the warning when a text-mode revision changes the text under an
anchor (`domain/anchorWarnings.ts`, checked via ProseMirror's own step mapping rather than by
re-resolving text) are what Phase 3's history UI now has to build on.

Not carried over from the redesign: a per-anchor "remove just this one" UI affordance before
sealing. `editor/anchorCommands.ts` has the commands to add or read anchors; undoing one before
sealing today means the browser's own undo (Ctrl+Z), which only ever undoes the most recent
placement, not an arbitrary earlier one in the same session. A small, well-scoped follow-up once
anchor-mode has seen real use, not a blocker.

**Follow-up simplification pass (2026-09-11):** `editor/extensions.ts` was doing two jobs — the
TipTap schema and an imperative command API over it — split so `extensions.ts` stays schema-only
and `editor/anchorCommands.ts` holds `addAnchorMark`, `addAnchorInsert`, `anchorSpans`,
`mapAnchorSpans`, and the `isAnchorEdit` guard predicate. No behavior change; `DocumentEditor.vue`
is the only importer and just points at two modules instead of one.

### Parked, not decided against

Genuinely deferred rather than rejected — worth another look later, but not now:

- **Detecting a stale revision session.** Opening an entry to revise it, leaving the tab, and
  revising the same entry again from another tab (still one person — this app has no accounts or
  sync) currently seals with no warning; the version chain still records both, so nothing is lost,
  just unannounced. `DraftTarget`'s revision variant briefly carried a `base_version_id` toward this
  and was removed (2026-09) since nothing read it; a real fix would need to actually compare it
  against the entry's current version at seal time, which wasn't built. Worth revisiting once it's
  clearer what the right response is (block the save? offer to rebase? just say so louder?), and
  worth reconsidering the mechanism entirely rather than assuming the removed field was the answer.
- **`sameContent`'s several full-tree walks per keystroke.** Fine today. The anchor redesign turned
  out not to force a shape change here after all — the anchor-carried-wording skip landed in the
  shared `nodeText` helper `docToPlainText` already called, so `sameContent` itself never changed —
  but the walk-per-keystroke cost itself is unaddressed and still worth revisiting sometime.

### The September 2026 review pass — closed

A code-review pass (2026-09-11) found two halves of work. The correctness/race-condition half was
fixed and committed first; this half — dedup and finishing gaps, none of it touching anchors — is
now done too. What it came to:

- **`ConnectionForm.vue`'s dead `submitting` guard is gone.** It could never be observed true
  (`handleSubmit` set it, emitted synchronously, and reset it in `finally`, all before Vue flushed a
  render), so it and its `:disabled` bindings were dead weight. Whether a save is actually in flight
  is the parent's to know, and it already says so through the `disabled` prop, which stays.
- **`src/composables/useMedia.ts` now has tests** — `useMedia.browser.test.ts`, covering URL reuse
  per id, a missing blob resolving to null rather than a broken URL, `applyTo` filling in only
  unresolved images and labelling the ones whose blob has gone, and revocation on scope disposal.
  Vitest Browser Mode only, and no Cypress mirror: a composable is not a component, the same reason
  `DexieEntryRepository` is proven in one runner (TESTING.md, "Not everything belongs in Cypress").
- **`--color-error` exists** in `src/assets/main.css` with a `.dark` variant, and every
  `text-red-500` is gone — the four call sites the review named plus `TimelineView.vue`, which has
  the same store-error paragraph and would otherwise have been the one hard-coded colour left.
- **`preview()`, `formatDate()`, and the error-message ternary are each written once.**
  `previewText(content, limit)` lives in `domain/entryDocument.ts`, taking stored content rather
  than pre-flattened text so the `docToPlainText` call is inside it too; `formatDate(iso, dateStyle)`
  and `toErrorMessage(err, fallback)` live in the new `src/utils/format.ts`, which is display
  formatting and deliberately not domain. The copies disagreed, so consolidating had to make
  choices: preview limits stayed per-call-site as an argument (160 on a timeline card, 120 on a
  draft row, 60 for a picker label), `previewText` returns the empty string for an empty document
  instead of naming it, and `EntryDetailView`'s `entryLabel` supplies "Untitled entry" where a blank
  row would otherwise appear. `toErrorMessage` also falls back on an `Error` with an empty message,
  which no copy did. The two stores were swapped over as well, since leaving three hand-rolled
  copies behind is the drift this item was about.
- **The duplicated "edit an open draft session" scaffold** was resolved earlier, by the
  `useDraftSession` composable in the 2026-09-11 simplification commit. The one thread still tracked
  by hand is `EntryDetailView`'s `childParentContent` — the parent document gaining provisional
  anchors, which is a second document the composable does not model and which is documented as such
  at its declaration.
- **`src/testing/realRepositories.ts` shares one `ChronicleDatabase`** between entries and drafts,
  matching the composition root. It is opened on first use, so a spec needing only one of the two
  still opens only one connection. This is what lets a future test of the anchor-mode atomic seal
  (parent revision + child, one transaction) run against the shape production actually has.

## Implementation Rules for the AI

- Testing is non-negotiable in every phase — write tests alongside features.
- Prefer Composition API + `<script setup>`.
- Keep all data access behind a clean repository/service layer.
- Core domain logic: `reconstructEntryState` (pure function) rebuilds aggregated or historical entry state from related entries.
- Design so historical reconstruction and aggregated views remain easy.
- Prefer appending new Entries over mutating existing ones.
- Do not hard-code colors or styles in a way that makes dark mode painful later.
- Small, focused commits.
