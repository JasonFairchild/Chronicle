# Reshaping drafts

A short-lived plan, found during the reading pass (CHRONICLE_PLAN.md, Priorities). Delete it once
built; what lasts belongs in AUTHORING.md, "Drafts", and PRODUCT.md §5.3.

## Why

- **`parent` exists only for `new_child`, and nothing but a comment says so.** `Draft.parent` is
  `… | null` for every target.
- **The entry being written is split in two.** Its `title` and `dates` sit on `Draft`, its content
  and events in `child`. The parent's `title` sits inside _its_ buffer, though it is a display copy
  nobody writes.
- **`child` is a misnomer.** For `new_root` and `revision` it holds an entry that is nobody's child.
- **"Session" means two things.** `AuthoringSession` is one per document, so an anchor-mode draft
  holds two, and the word can't name the writing session as a whole.
- **Versions can branch.** Two drafts opened against v3 seal as v4 and v5, and v5 silently writes
  over v4. PRODUCT.md §5.3 decides this can't happen.

A generic session holding N drafts or buffers was considered and rejected: there are never more than
two documents, their roles differ (the entry being written, a parent only receiving anchors), and
the two seal, list, flush, and discard as one. Named roles say more than an array, and splitting
them would move that coupling out of the type into runtime rules.

## Part 1: the shape

```ts
/** One document a session is writing: where it started and where it is. */
interface DraftDocument {
  base_version_id: string | null // Null for a new entry. Part 2's check reads it.
  base_content: string
  content: string
  events: AuthoringEvent[]
}

/** The entry this session produces: its document plus the fields written beside it. */
interface DraftEntry extends DraftDocument {
  title: string | null
  dates: EntryDates
}

type Draft = { session_id: string; started_at: string; updated_at: string; entry: DraftEntry } & (
  | { kind: 'new_root' }
  | { kind: 'new_related'; parent_id: string; parent: DraftDocument }
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent_id: string }
)
```

- `DraftTarget` folds into `kind`, so `parent` exists exactly when the type says it does. PRODUCT.md
  §5.4's revise-note session later adds a variant with a `parent` too.
- Id field names stay `parent_id`/`target_id`, mirroring the `Entry` fields each kind writes.
- `AuthoringBuffer` becomes `DraftDocument`; `child` becomes `entry`; `new_child` becomes
  `new_related` (Part 3), without `Entry` to match its sibling kinds.
- The parent's `title` leaves storage. `useDraftSession`'s resume looks it up, as `DraftsView`
  already does for its labels.
- Each document records the version it started from, since §5.4's session will have two.
- `AuthoringSession` becomes `TraceRecorder` (its own doc comment already calls it "the recorder"),
  and `ActiveSession`'s `session`/`parentSession` become `recorder`/`parentRecorder`. "Session"
  then means only the writing session, which is the draft, one per `session_id`.
- `StoredDraftEvent.document` becomes `'entry' | 'parent'`. The index spec doesn't change; clear
  IndexedDB rather than migrate (CLAUDE.md).
- `DraftSummary` follows the new shape.

Touches `src/types/draft.ts`, `src/domain/authoringSession.ts`, `draftsStore`, the three draft
repository files and their contract, `chronicleDatabase.ts`, `useDraftSession`, `DraftsView`,
`entriesStore.createFromDraft` (switch on `kind`), and fixtures. The Drafts test overhaul comes right
after, so change tests only as far as it takes to pass.

## Part 2: versions never branch (PRODUCT.md §5.3)

- **The block.** While a draft that could revise an entry is outstanding (a `revision` or a
  `new_related` on it), neither Revise nor a new related entry is offered on that entry; the UI
  offers to resume the draft instead. Connections aren't blocked: they revise nothing.
- **The check.** Sealing refuses when a document's `base_version_id` is no longer its entry's
  latest version, as a backstop for what slips past the block (another tab).

## Part 3: "related entry" as the term

"Child" means two things: any entry whose `parent_id` points here (revisions and connections
included), and an annotation or update specifically, which the UI calls a related entry. The first
is exact and stays, along with "parent" and `parent_id`. The second becomes **related entry**
everywhere, so "child" only ever means the tree link.

- Names that stand alone take `Entry`: `ResolvedChild` → `ResolvedRelatedEntry`, `createChildEntry`
  → `createRelatedEntry`, `AggregatedEntry.children` → `related_entries`. A value among siblings
  matches them instead, as `new_related` does.
- PRODUCT.md says "note" for the same thing (§4.4, §5.4, its vocabulary's Annotation and Update
  rows), a third term. It becomes "related entry" too, and the vocabulary gains a row for it.
- Docs follow: ENTRY_MODEL.md's "Child entries and anchors" and its anchor prose ("the child stores
  its anchors"), AUTHORING.md, PRODUCT.md, and CLAUDE.md's "No child entry is destructive", which
  is only true in the narrow sense (a revision is a child and writes content) and becomes "No
  related entry or connection is destructive".
- Not a find-and-replace: "child" has ~370 matches across 45 files, many of them the tree sense
  (`childrenOf`, the ENTRY_MODEL table's "children" column). Each use is judged in context.

## Done when

Typecheck and every suite pass; AUTHORING.md's "Drafts" (its code block included), ENTRY_MODEL.md's
one `AuthoringSession` mention, and PRODUCT.md §5.3 describe what was built; no narrow "child" is
left in code or docs; this file is deleted.
