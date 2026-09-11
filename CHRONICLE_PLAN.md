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
sealing. `editor/extensions.ts` has the commands to add or read anchors; undoing one before sealing
today means the browser's own undo (Ctrl+Z), which only ever undoes the most recent placement, not
an arbitrary earlier one in the same session. A small, well-scoped follow-up once anchor-mode has
seen real use, not a blocker.

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

### Still to do from the September 2026 review pass

A code-review pass (2026-09-11) found these; the correctness/race-condition half of its findings is
already fixed and committed. This half — dedup and finishing gaps, none of it touching anchors — was
queued next but not yet done when work paused to clear the session:

- **`ConnectionForm.vue` has the same dead `submitting` guard** as `ChildEntryForm` above, but
  `ConnectionForm` is not being rebuilt, so this one should actually be removed: the state can never
  be observed true (`handleSubmit` sets it, emits synchronously, resets it in `finally`, all before
  Vue flushes a render), so it and its `:disabled` bindings are dead weight.
- **Missing tests for `src/composables/useMedia.ts`.** Still true. `extensions.ts` is no longer bare:
  the anchor-mode mechanism it added (`Anchor`, `AnchorInsert`, `isAnchorEdit`, `addAnchorMark`,
  `addAnchorInsert`, `anchorSpans`/`mapAnchorSpans`) now has coverage in
  `DocumentEditor.browser.test.ts`'s "anchor mode" suite (and its `.cy.ts` mirror), and pure logic
  moved out to node-tested `domain/anchors.ts` / `domain/anchorWarnings.ts` where it could be.
- **Hard-coded `text-red-500`** in `DocumentEditor.vue`, `EntryForm.vue`, `DraftsView.vue`, and
  `EntryDetailView.vue` — every other color in these files routes through the `--color-*` token
  system; this is the one thing that doesn't. Needs a `--color-error` token (with a `.dark` variant)
  in `src/assets/main.css`, then swap all four call sites.
- **`preview()`, `formatDate()`, and the `err instanceof Error ? err.message : …` pattern are each
  copy-pasted three-plus times** across `TimelineCard.vue`, `EntryDetailView.vue`, and `DraftsView.vue`
  (`preview`/`formatDate` already disagree on their limits/styles between copies). Consolidate
  `preview`/`formatDate` near `entryDocument.ts` (they always wrap `docToPlainText` output) and the
  error-message pattern into a small `toErrorMessage(err, fallback)` helper.
- **`EntryDetailView.vue` and `DraftsView.vue` duplicate the whole "edit an open draft session"
  scaffold** (mirror a `draftsStore` session's content into a local ref, track a saving flag, forward
  `DocumentEditor`'s `@change`, wrap save/discard in the same try/catch) and have already drifted —
  `DraftsView` guards on `isEmptyDocument` before sealing, `EntryDetailView` doesn't. This predicted
  its own worsening correctly: `EntryDetailView.vue` now carries a _third_ copy of the pattern for
  the anchor-mode session (`childSession`/`childParentContent`/`childNoteContent`/`savingChild`,
  plus a fourth thread of state for the revision warning), landed inline rather than through a shared
  composable for lack of turnaround time. `useDraftSession` (or similar) is more overdue now than
  when this was first written, not less.
- **`src/testing/realRepositories.ts` gives entries and drafts two separate Dexie connections**
  (`freshEntryRepository()` / `freshDraftRepository()` each open their own uniquely-named database),
  while `src/repositories/index.ts` deliberately shares one `ChronicleDatabase` between them in
  production. No current test exercises a transaction spanning both, so nothing fails today — but a
  future one added as part of the anchor-mode atomic seal (parent revision + child, one commit) would
  work in production and silently diverge in any test using both repositories together. Fix by
  sharing one `ChronicleDatabase` instance in the test helper, matching the composition root.

## Implementation Rules for the AI

- Testing is non-negotiable in every phase — write tests alongside features.
- Prefer Composition API + `<script setup>`.
- Keep all data access behind a clean repository/service layer.
- Core domain logic: `reconstructEntryState` (pure function) rebuilds aggregated or historical entry state from related entries.
- Design so historical reconstruction and aggregated views remain easy.
- Prefer appending new Entries over mutating existing ones.
- Do not hard-code colors or styles in a way that makes dark mode painful later.
- Small, focused commits.
