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

The promises themselves are [PRODUCT.md](./PRODUCT.md) §2. What they mean for _planning_:

- Immutability and offline-first are architectural constraints from day one, not later retrofits — every phase below has to hold them.
- Start with text + images; other media is a later phase, not an early abstraction to design around.
- Dark mode must stay reachable (CSS variables / Tailwind dark mode from the start), but finishing it is low priority for the first milestones.

## Tech Stack

- Vue 3 + TypeScript + Vite
- Tailwind CSS (dark mode class strategy ready)
- Pinia
- Vue Router
- Local DB: SQLite via `@sqlite.org/sqlite-wasm` + OPFS (preferred) or Dexie.js as fallback
- Rich text: TipTap (Phase 1; plain text is fine in Phase 0)
- PWA: vite-plugin-pwa
- Testing (required in every phase): Vitest (unit + Browser Mode) and Cypress Component Testing.
  Running both is an intentional tool-comparison experiment — the author is experienced with Cypress
  and wants Vitest's browser/component story in depth — so duplicated component specs are expected
  and fine; revisit only once the comparison has served its purpose. See
  [TESTING.md](./TESTING.md) for the file-suffix convention and everything about how tests are
  written.
- Later candidates: Vue Flow (graph), virtualization helpers

## Data Model (Unified & Extensible)

**See [ENTRY_MODEL.md](./ENTRY_MODEL.md) for the authoritative model and the reasoning behind it.**
What follows is an orientation, not a specification.

`entries` table / collection:

- `id` (UUIDv7) — time-ordered, so it breaks `created_at` ties and gives history a total order
- `created_at` (immutable) — when the entry was added to Chronicle; system-set
- `parent_id` (nullable) — the entry this one is attached to; containment follows this and only this
- `relation_type` (nullable) — `annotation` | `update` | `connection` | `revision` (roots are null)
- `target_id` (nullable) — the far endpoint of a `connection`
- `anchors` — the places in the parent this entry operates on; empty means "the parent at large"
- `revision_mode` (nullable) — which creation experience wrote a revision; null on everything else
- `authoring_trace` (nullable) — how this snapshot was typed
- plus the fields a revision replaces wholesale, grouped as `VersionedFields`: the two user-supplied
  dates and their free-text notes, `location`, `original_medium` and its note, `title`, `content`,
  `media_refs`, and `metadata`

The three dates are deliberately separate: `created_at` anchors the immutable ledger, while `recorded_at` / `occurred_at` are user-supplied and let the timeline be ordered by when things _happened_ rather than when they were entered. A bulk import shares one `created_at` by design; `occurred_at` is what such entries get sorted by.

### Relation types

Only two of these change how the domain layer behaves. The other two are a label.

- **`revision`** — a new version of the entry itself, and the _only_ relation that writes content. Full-state snapshot, last one wins. This is the mechanism behind "smarter edit" and behind capturing how a first draft was written.
- **`connection`** — a directional edge between two entries (`parent_id` = source, `target_id` = destination), carrying the user's thoughts about why they relate. Gathered onto both endpoints, but never traversed as containment.
- **`update`** — a child entry that reports what changed or happened next, usually anchored to a specific passage. Updates accumulate and are visualized over time; they never overwrite the parent.
- **`annotation`** — a note on an entry or on a passage within it. Does not claim anything changed.

The update/annotation split is a label for UI and filtering. Structurally both are children carrying anchored operations, and what the user actually did — striking a phrase, inserting wording, or just commenting — is what distinguishes them.

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

Product-level ideas are parked in [PRODUCT.md](./PRODUCT.md) §6, which is the parking lot for
anything describable from the outside. What follows is the engineering half: work deferred for
reasons that only make sense against the code.

The “smarter edit” experience is not among them — it is designed in
[ENTRY_MODEL.md](./ENTRY_MODEL.md) as the `revision` relation plus authoring capture, and the
capture layer it needs is built, as are replay and the mark sets a history view plays
(ENTRY_MODEL.md, "Mark sets"). Diff rendering and the scrubbable history UI itself are Phase 3.

A stale anchor draft against a revised parent is a deliberately unhandled gap: sealing an
anchor-mode session writes `Draft.parent.content` as a full-state revision
(`entriesStore.sealAnchorChild`), so if the parent was text-revised — or another child's anchor-mode
session sealed on it — after this session began, sealing silently reverts the parent to the stale
snapshot the session started from, orphaning whatever the other revision or child added. The
intended fix is to detect it and offer to discard, not to rebase, which needs a recorded base version
on the draft — the same mechanism parked under "Detecting a stale revision session" below, since it's
the identical problem for a text-mode revision session.

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
- **Cross-tab drafts, and re-deriving a session.** Two tabs holding one draft each flush the whole
  row, so each write clobbers the other's snapshot _and_ event log. A `refreshSession(sessionId)`
  rebuilding the store's `active` entry from the stored row — document and event log together,
  since a swapped document over an old log leaves a trace that no longer composes — would answer
  this and the stale revision above. Trigger on `visibilitychange` rather than focus: `DocumentEditor`
  seeds on mount, so refreshing re-keys it, and doing that under a click costs the caret. Announce
  it with a `BroadcastChannel` message per flush rather than polling — IndexedDB fires no storage
  event, and "a draft changed" is the seam a sync layer would want anyway. It also makes sessions
  left in `active` when a view unmounts stop mattering: what can be re-derived need not be held.
- **A shared shell for the entry composers.** Four screens put a document editor, usually the date
  fields, and a Discard/Save pair inside the same frame: `EntryForm`, `DraftsView`'s resumed draft,
  `NewConnectionView`, and `EntryDetailView`'s revision. A slot-based shell (header, intro,
  warnings, actions, with dates and editor built in) would hold them, and slots avoid the prop
  explosion a props-based version would need. Held off because the four differ more than they look:
  the revision composer has no dates at all and carries a warnings line, `EntryForm` is a `<form>`
  with a submit button, `DraftsView`'s sits in a list row with errors at page level, and
  `NewConnectionView` has a target picker above everything — so a shell absorbing all four would own
  little beyond spacing, while the buttons stay in the caller's slot. The duplication that is
  actually costly is smaller and separate: the primary button's exact class string appears in five
  files and the secondary's in four, which is a case for two presentational buttons (or `@utility`
  classes) rather than a frame. `RelatedEntryComposer` is the sharing that did pay — two screens
  needed the same concrete composer, so the whole thing moved, behaviour included. Worth a careful
  second look: the suspicion is that more would consolidate than this note credits, and a real
  attempt might find the shell earns its keep after all.
- **`sameContent`'s several full-tree walks per keystroke.** Fine today. The anchor redesign turned
  out not to force a shape change here after all — the anchor-carried-wording skip landed in the
  shared `nodeText` helper `docToPlainText` already called, so `sameContent` itself never changed —
  but the walk-per-keystroke cost itself is unaddressed and still worth revisiting sometime.
- **How a revision warns about anchored passages.** Today `DocumentEditor` maps every anchor's span
  through each transaction to keep a sticky "this changes the passage X is about" line live under
  the revision composer. That state lives in the editor instance, so a reload clears it and a
  revision resumed from the drafts list never warns. The existing anchors are highlighted in the
  editor either way, which may be warning enough while typing. Candidates once the revise and
  add-anchor experience is rethought:
  - Judge it once, on save or seal, from the draft's log (replay from `base_content`, mapping the
    base's anchor spans through every step).
  - Simpler still, compare each anchor's marked text in `base_content` against the final document.
    This keeps no live tracking at all, but loses PRODUCT.md §4.5's sticky rule (an edit changed
    back still counts).

  The intended direction: once an anchor-mode revision lands on an entry, its anchors should be
  prominent parts of that entry from then on. So editing text under an existing anchor in a later
  text-mode revision probably ought to count as something, not the plain typing it reads as today.
  `is_anchor_op` fires only when the set of anchor ids and kinds changes. That could mean a stored
  signal, a mark reason, the warning above, or all three. A signal needn't wait for new capture: the
  log replays, so it can be derived for sessions already recorded by mapping the base's anchor spans
  through the steps.

- **Session tracking as a ProseMirror plugin.** `DocumentEditor`'s `onUpdate` merges
  `[transaction, ...appendedTransactions]` by hand, and holds `liveAnchorSpans`, `affectedAnchorIds`
  and `heldSteps` as component variables. A plugin with state (`state: { init, apply(tr, value) }`)
  is ProseMirror's native home for this: `apply` sees every transaction, appended ones included,
  with `tr.mapping` in hand. It also makes the tracking testable in node against a bare
  `EditorState`, with no browser needed, and lets it feed decorations if a disturbed anchor should
  show in the editor itself. Worth doing whenever the warning above is rethought, not on its own.
- **Validating content against the schema before it's stored.** `parseDocument` checks only
  `type === 'doc'`, and rows are immutable, so a malformed document would be permanent — `replay.ts`
  already returns null for one that no longer fits. Content comes only from the editor today, so it's
  valid by construction; seeding, import, and sync won't be. `schema.nodeFromJSON(json).check()` is
  the check. The open question is where it lives, since the domain deliberately doesn't import the
  editor's schema: the store layer, or a validator injected into it.
- **Painting frames with decorations.** When the Phase 3 history view is built, a read-only editor
  view with a `DecorationSet` built from each frame's `FrameChange` ranges would highlight a frame
  without touching its document: no injected marks, no hand-built HTML.

- **Showing what a revision changed from its frames.** PRODUCT.md §5.2 could reuse the mark-set
  frame builder, treating a whole session as one frame, so `diffDocuments` (which has no production
  caller yet) would only be needed for a revision with no trace.

## Implementation Rules

See [CLAUDE.md](./CLAUDE.md), "Rules that always apply" — the write rule, ordering, the repository
boundary, tests alongside every feature, Composition API, dark-mode-safe colors, and commit style
all live there rather than being restated per document.
