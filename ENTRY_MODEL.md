# Chronicle Entry Model

How entries are shaped, how they relate, and how they change over time. How a writing session is captured, and the draft it lives in until it's saved, is [AUTHORING.md](./AUTHORING.md).

A related entry is not a note stapled to a parent. It is a set of **operations on specific places in the parent**, grouped under one explanation. That idea drives most of what follows.

"Child" means only the tree link: any entry whose `parent_id` points at another, revisions and connections included. An annotation or update specifically is a **related entry**.

## Two invariants

**No related entry or connection is ever destructive.** A related entry marks passages and adds wording, and never changes or removes the parent's own words; the guard enforces it ("Two creation experiences, kept separate"). A strike is presentational: the struck words stay. Content changes only through the version chain.

**Timeline membership is a view filter, not a model fact.** Any entry may appear in a timeline; revisions in a filtered timeline are a legitimate view. Marks are not entries and never appear.

## Related entries and anchors

A related entry doesn't store where it points; the parent's own document does, since a position is a fact about the parent. A span op (`comment`, `strike`) is an `anchor` **mark** on the parent's text carrying `{ anchorId, kind }`. Wording an op proposes (inserted wording, including a strike's replacement) is text in the parent's document carrying an `anchorWording` **mark**, `{ anchorId }`, right after its passage. Wording with no passage is a bare insertion, placed by where its text sits.

A shared `anchor_id` _is_ the pairing of wording with its passage — a strike plus its replacement, a highlight plus an inline comment — declared, not inferred from proximity. `markTyped` (`editor/anchorCommands.ts`) gives typed text the id of the anchor this session placed that it sits against: the passage or wording just before it, or the wording just after, whatever its kind. The mark is `inclusive: false`, so typing at an anchor's edge isn't absorbed into it, and `excludes: ''`, so one anchor's mark never strips another's on the same span. Exclusivity is enforced at the command level instead (`markAnchor`, `editor/anchorCommands.ts`): a selection overlapping any existing anchor never places a new one over it, though one meeting only its edge does. The wording mark excludes every mark, itself included, so wording carries no passage and no formatting.

**Where an anchor is, in the editor.** `anchorIndex` (`editor/anchorIndex.ts`) reads each anchor in a document once: its span from first piece to last, so a passage and its wording are one stretch, its kind, and its pieces. The guard, the decorations and the commands all read it, so they share one definition of where an anchor is. ProseMirror documents are immutable, so it's kept per document, and a caret move walks nothing. Only if a profile shows the walk per edit matters: an index per top-level block, which an edit leaves shared, so a rebuild reads only the changed paragraph.

There is no `replace` op. "I would have written this differently" is a strike plus wording sharing its id; a replace op would imply hiding the parent's text, which nothing does.

**What the related entry stores.** `anchors: AnchorRef[]`, each `{ anchor_id, quote }`: an id referencing marks in the parent, plus the wording it covered at seal time. Empty means it is about the parent at large. `quote` is what renders "was attached to: …" once a later revision has removed the anchor.

**Where wording lives.** The parent's document holds anchor structure and any wording with a position in it; the related entry holds the prose explanation. Per-op commentary should lead to additional related entries. Inline wording is plain single-line text; a thought needing more belongs on the related entry. Wording reads as the parent's own text: `docToPlainText` includes it as typed, so previews and diffs read it, as search will. Its mark, stored in every version, is what keeps it the related entry's.

**Annotation and update are labels, not structure.** A related entry with a strike or proposed wording behaves like an update, one with only comments like an annotation; the difference falls out of what the user did. The labels drive icons, defaults, and filtering, never domain logic. Only `connection` and `revision` are structural.

## Anchor resolution

`resolveAnchors` (`domain/anchors.ts`) walks the parent's current document for each `anchor_id`: found is `present`, and the document says what it covers now; not found is `orphaned`, and the related entry's `quote` renders instead. There is no ladder in between, because there is no position to drift: the mark survived the parent's edits or a revision removed it.

Live editing needs no resolution: anchors are marks in the document being edited, so a revision renders them natively. Resolution is for a reader reconstructing what a related entry points at.

## Two creation experiences, kept separate

Revising an entry's own text and creating a related entry are modes that never mix in one sitting. Text mode is ordinary editing and cannot add anchors. Anchor mode (`DocumentEditor.vue`'s `anchor-mode` prop) allows only select-then-comment/strike and proposing wording at the caret.

That makes "no related entry is destructive" hold by construction. A guard (`allowsEdit`, `editor/anchorGuard.ts`) runs as a `filterTransaction` in every editor, against a snapshot taken as the editor opens: each sealed anchor, from its first piece to its last, with the blocks around it. A change is refused unless each is still there exactly, so anchored text is locked in every editor (PRODUCT.md §4.5). In anchor mode it also refuses everything but typed bare text and deleting the session's own wording, letting anchor commands and undo through; a marker (`markTyped`, `editor/anchorCommands.ts`) then gives typed text its wording mark. The guard judges what a change did, never the caret or selection: Backspace just after a passage deletes inside it, and drop, paste, undo and IME change text away from the selection. Paste strips anchor marks in every editor, so a copy never carries an `anchor_id` somewhere new; the guard itself doesn't refuse a new anchor.

What's sealed is the snapshot: in a revision, every anchor in the document it opens; in anchor mode, every anchor in the session's base, so those placed since are the session's own. A wrong base unlocks an earlier related entry's anchors, and the seal writes their removal into the parent's next version. The snapshot relies on an editor never being handed a new document in place: both composers key DocumentEditor on the session, so a new document is a new editor and a new snapshot.

An anchor-mode session edits two documents and seals atomically, via `EntryRepository.createMany`, into a parent revision (`revision_mode: 'anchor'`) and the related entry. If nothing was anchored, only the related entry is written. `createMany` is all-or-nothing, so a revision whose anchors no entry explains, or an entry pointing at ids nothing carries, is never representable. An anchor revision is a version like any other, counted wherever versions are. `revision_mode` only records which kind of session made it, which nothing could recover once stored.

**Annotation vs update is derived at seal time.** `relationTypeForAnchors` (`domain/anchors.ts`) reads the anchors the session placed: a `strike` or proposed wording makes an `update`; only `comment`s, or no anchors, make an `annotation`. So a `new_related` draft carries no `relation_type`.

**Before sealing**, a session may return to, switch, or remove the anchors it placed (AUTHORING.md, "Drafts", says how it knows which). **After sealing, anchors are fixed** in every editor, by the guard above — append-only, like entries. Reopening a sealed related entry's anchors would be ordinary document steps on the parent and is possible in principle, and decided but not built (PRODUCT.md §5.4); it, not overlap, is the intended way to say something different about an anchored passage.

**Color.** Never stored. It is computed at render time from the active scheme, the related entry, and the kind, so swapping schemes never touches history. The only scheme built is by kind (`--color-anchor-*` in `src/assets/main.css`); others are in PRODUCT.md §6.

## Version chains

Each entry owns a linear chain: its own content is version one, frozen at creation, and its revisions are versions two onward. Current state is the last version at or before the viewing time, a plain fold. A revision's parent may not itself be a revision. A subtree's activity stream is derived by merging child chains on timestamp.

**The chain never branches.** A version's id is the id of the row it came from: the entry's own for version one, the revision's after that. Each revision records the version it replaced in `base_version_id`, copied from the draft that wrote it, and `assertValidRelation` (`domain/entryValidation.ts`) refuses one whose base isn't its entry's latest version with a `StaleVersionError`. The check runs inside `createMany`'s transaction, so nothing can land between it and the write, and it covers every write path. So each version's predecessor is the one it was written against, not merely the one sealed before it, and a branch that sync ever produced would be visible in the data rather than silently shadowing a version.

Every link carries `content`, the resulting document snapshot, and `authoring_trace`, how it was typed — identically for an entry and each of its revisions.

A revision is a full-state snapshot of `VersionedFields` — content, media, metadata, title, dates and their notes, location, original medium and its note — not content alone, or revising would drop images. `Entry`, `EntryVersion`, and `AggregatedEntry` all extend it, so the revisable fields are declared once. The edit surface seeds from the current aggregate, never a raw row, which is how a revision that only rewords carries everything else forward. Snapshotting is also what makes a title or date correctable: the old value stays with its version. `created_at` is the ledger's own stamp and is never correctable.

`media_refs` is **derived from the document** (an image is a node carrying a blob id), so it can't drift from it.

## Connections

A connection is a directional edge: `parent_id` is the source, `target_id` the destination. It is named like any entry (`entryLabel`, `utils/format.ts`), with no relation vocabulary of its own, and is created through the full composer (`NewConnectionView.vue`). Both endpoints surface it, gathered by `parent_id === id || target_id === id` and marked `outgoing` or `incoming`.

**`parent_id` alone defines containment; `target_id` is gathered but never traversed.** Walking `target_id` as if it were a parent breaks three things: a related entry on a connection folds into both endpoints and counts twice; connections chain, so the walk can cycle, and a visited set makes the result depend on traversal order; and "an entry's subtree" stops being well defined. So a connection's children belong to the connection.

PRODUCT.md §5.7 folds connections into related entries, with targets versioned like content; CHRONICLE_PLAN.md has the engineering.

## Imports

**An import produces media, not entries.** Scans land in the media store as an unfiled queue, and each becomes an entry only through a deliberate act where the user supplies context and dates. That settles `created_at` for imports: it is when the record entered Chronicle, so a batch shares one, and sorting by when things happened is what `occurred_at` and `recorded_at` are for. Within a batch, order falls to the id tiebreak — arbitrary but stable.

## Fields

```ts
type RelationType = 'annotation' | 'update' | 'connection' | 'revision'

type RevisionMode = 'direct' | 'anchor' // which creation experience wrote a revision

interface AnchorRef {
  anchor_id: string // references a mark/node in the parent's own document
  quote: string // what the parent said under it at seal time; the orphaned fallback
}

interface EntryDates {
  recorded_at: string | null // YYYY-MM-DD, user-supplied
  recorded_time_note: string | null // freeform: "evening", "after dinner"
  occurred_at: string | null // YYYY-MM-DD, user-supplied
  occurred_time_note: string | null // freeform: "morning", "3:30 pm"
}

// The fields a revision replaces as a full-state snapshot. See "Version chains" above.
interface VersionedFields {
  dates: EntryDates
  location: string | null // a name the author reuses: "home", "grandma's"
  original_medium: string | null // what it was first recorded in: "paper journal"
  original_medium_note: string | null // freeform: "blue Moleskine, 2014-2016"
  title: string | null // a name the author gave it; never required
  content: string // serialized ProseMirror document
  media_refs: string[] // OPFS blob ids the document depends on
  metadata: Record<string, unknown>
}

interface Entry extends VersionedFields {
  id: string // UUIDv7: time-ordered and sortable as text
  created_at: string
  parent_id: string | null
  relation_type: RelationType | null
  target_id: string | null // connections only
  anchors: AnchorRef[] // empty = about the parent at large
  revision_mode: RevisionMode | null // revisions only; null everywhere else
  base_version_id: string | null // revisions only: the version this one replaced
  authoring_trace: AuthoringTrace | null
}
```

| relation      | parent_id | target_id   | writes parent content                      | children |
| ------------- | --------- | ----------- | ------------------------------------------ | -------- |
| `null` (root) | null      | null        | is the base state                          | yes      |
| `annotation`  | required  | null        | never                                      | yes      |
| `update`      | required  | null        | never                                      | yes      |
| `connection`  | source    | destination | never                                      | yes      |
| `revision`    | required  | null        | yes, replacing the latest version it names | no       |

**`id` is a UUIDv7.** `created_at` has millisecond resolution, so it isn't a total order; a v7 id carries a millisecond timestamp in its leading bits, so ids sort correctly as plain text and every sort tiebreaks on it. It beats ULID on being an IETF standard, and a sequence column would need every storage adapter to agree on one owner. `crypto.randomUUID()` emits only v4, so generation is a small helper.

**`title` is a plain field beside the document**, folded through the version chain like the dates, and never parsed out of `content`. It is edited in an `<input>`, not as a node in the document, which makes it immune to the toolbar, `## `, and paste by construction. It produces no steps, so it is absent from the authoring trace. **It is never required**: the untitled case is the ordinary one. Surfaces with room for both text and title show the title only when there is one; one-line surfaces fall back to `entryLabel`.

**The two user-supplied dates are days, not instants**, each with a free-text companion. `YYYY-MM-DD` because a person entering a 1994 entry knows the day, and an instant would invent precision and shift the day across timezones. Whatever precision exists goes in `*_time_note`, unparsed until something sorts by it. The notes are columns rather than `metadata` even though nothing queries them yet, since a note split from the date it qualifies makes every reader look in two places.

**`location` and `original_medium` are small vocabularies the author grows**, stored as plain strings. A location is a reusable name, not coordinates; `original_medium` says what an entry was first written in, and is mostly null. The picker's options are the distinct values already in use, so they can't drift from the data. They are separate fields rather than tags because where and what it was written in are different questions from topic; if tags arrive and this proves wrong, they collapse into tags.

**`authoring_trace` is null when typing was not captured**: imports, seeds, fixtures, and programmatic creation.

**`metadata` holds only what neither drives logic nor gets queried** — an import's source filename, the originating app version. Anything filtered, sorted, or joined on graduates to a column; `original_medium` already has, and tags are the likeliest next.

**There is no `type` or `content_format` field.** An entry with an image is a document containing an image node; a display kind is derived when needed. `content` is always a serialized document.

## Aggregate

Related entries are exposed as collections, never concatenated into the parent's text, which would make anchoring impossible and `content` at a given time untrue.

```ts
interface AggregatedEntry extends VersionedFields {
  id: string
  created_at: string
  // VersionedFields are this entry's OWN state at asOf, folded from its version chain.
  version: { index: number; total: number; at: string; revision_id: string | null }
  related_entries: ResolvedRelatedEntry[] // annotations and updates, newest first
  connections: ResolvedConnection[]
}

interface ResolvedRelatedEntry {
  entry: AggregatedEntry
  relation_type: RelationType
  anchors: ResolvedAnchor[] // its anchors, read out of the parent's current document
  has_children: boolean // grandchildren are indicated, not expanded
}

interface ResolvedAnchor {
  anchor_id: string
  status: 'present' | 'orphaned'
  quote: string // current wording if present, the recorded quote if orphaned
  kind: 'comment' | 'strike' | null // null for a bare insertion with no mark
  insertion: string | null // wording the anchor carries, if any
}
```

Default depth is 2: a parent view shows immediate descendants and signals that deeper ones exist.

## Considered and rejected

- **Yjs or another CRDT for content.** Character-level history and near-free sync, but the history becomes the library's rather than the app's — the exact thing this project exists to demonstrate.
- **A separate events table with materialized entries.** The entry log already is an event log.
- **Links, or revisions, in their own tables.** A link row couldn't carry prose, be revised, or take children; a revision table would cost the unified `Entry` and revisions in filtered timelines.
- **ProseMirror block ids as anchors.** Node attributes duplicate on split and vanish on merge, and give paragraph granularity where users want a sentence.
- **Injecting repositories with Vue's `provide`/`inject`** in place of the composition root's live bindings (`src/repositories/index.ts`). It would isolate app instances running side by side, which a single-user app doesn't have, and Pinia stores can only `inject` inside an active app. Revisit if that isolation is ever needed.
- **Several parents for one related entry.** It is `target_id` traversed as a parent, so it breaks what Connections lists: anything beneath it is reached twice from an entry above both parents, and an entry's subtree stops being well defined. Several targets, gathered and never traversed, let an entry be about several others without that.
- **Moving a related entry to another parent.** Containment that changes over time makes every subtree depend on when it's read, and the entry's anchors stay in the first parent's document. A related entry stays about its parent for good (PRODUCT.md §5.4).
- **Anchors as offsets stored on the related entry**, resolved by a fallback ladder (exact position, mapped through steps, quote search, orphaned). Every failure traced to one cause — a fact about the parent's document stored somewhere else — and moving anchors into the parent deleted the ladder.
- **Wording stored on the related entry**, so the parent only ever gains marks. A bare insertion still needs a node for its position, typing wording needs a field again, the parent at a time T needs each related entry's state at T, and wording loses its writing history.
- **Wording as an atom node** whose attribute an `<input>` rewrote whole on each keystroke, built first. Its events recorded no deletions and missed paste, undo took back the whole box, and the history view could show only whole-wording frames.
- **A guard judging each step's positions against anchor ranges**, built first. It had to settle which steps have a range, whether an edge is inside, how an anchor's pieces join, and the document each step saw, at twice the code, and still mispredicted a step that changes nothing. Judging the outcome against a snapshot replaced it.
- **A `DecorationSet` of sealed anchors mapped through each change**, in place of reading anchors from each new document. It sees text move but not marks added, so keeping it right means reading steps, which the guard exists to avoid.
- **Sealed anchors as uneditable islands** in the editor (an atom node, `contenteditable=false`). The trace records the editor's steps against the stored document, so its shape can't differ, and a deletion across an island still needs a guard.
