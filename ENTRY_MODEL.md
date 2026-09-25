# Chronicle Entry Model

How entries are shaped, how they relate, and how they change over time. How a writing session is
captured, and the draft it lives in until it's saved, is [AUTHORING.md](./AUTHORING.md).

A child entry is not a note stapled to a parent. It is a set of **operations on specific places in
the parent**, grouped under one explanation. That idea drives most of what follows.

## Two invariants

**No child entry is ever destructive.** A parent's stored text is never altered by its children.
Strikes and insertions are presentational. Content changes only through the version chain.

**Timeline membership is a view filter, not a model fact.** Any entry may appear in a timeline;
revisions in a filtered timeline are a legitimate view. Marks are not entries and never appear.

## Child entries and anchors

A child doesn't store where it points; the parent's own document does, since a position is a fact
about the parent. A span op (`comment`, `strike`) is an `anchor` **mark** on the parent's text
carrying `{ anchor_id, kind }`. A collapsed op (inserted wording, including a strike's replacement)
is an **atom inline node**, `anchorInsert`, carrying `{ anchor_id, text }`, since a mark can't hold a
zero-width position with content of its own.

A shared `anchor_id` _is_ the pairing of wording with its passage — a strike plus its replacement, a
highlight plus an inline comment — declared, not inferred from proximity. `pairableAnchorAt`
(`domain/anchors.ts`) picks the anchor this session placed immediately before the caret, whatever
its kind. The mark is `inclusive: false`, so typing at an anchor's edge isn't absorbed into it, and
`excludes: ''`, so one anchor's mark never strips another's on the same span. Exclusivity is
enforced at the command level instead (`markAnchor`, `editor/anchorCommands.ts`): a selection
touching any existing anchor never places a new one over it.

There is no `replace` op. "I would have written this differently" is a strike plus an
`anchorInsert` sharing its id; a replace op would imply hiding the parent's text, which nothing does.

**What the child stores.** `anchors: AnchorRef[]`, each `{ anchor_id, quote }`: an id referencing a
mark or node in the parent, plus the wording it covered at seal time. Empty means the child is about
the parent at large. `quote` is what renders "was attached to: …" once a later revision has removed
the anchor.

**Where wording lives.** The parent's document holds anchor structure and any wording with a
position in it; the child holds the prose explanation. Per-op commentary should lead to additional related entries.
Inline wording is plain single-line text; a thought needing more belongs on the child.
`docToPlainText` skips anchor-carried wording, so previews and search never fill with words the
parent's author didn't write.

**Annotation and update are labels, not structure.** A child with a strike or proposed wording
behaves like an update, one with only comments like an annotation; the difference falls out of what
the user did. The labels drive icons, defaults, and filtering, never domain logic. Only `connection`
and `revision` are structural.

## Anchor resolution

`resolveAnchors` (`domain/anchors.ts`) walks the parent's current document for each `anchor_id`:
found is `present`, and the document says what it covers now; not found is `orphaned`, and the
child's `quote` renders instead. There is no ladder in between, because there is no position to
drift: the mark survived the parent's edits or a revision removed it.

Live editing needs no resolution: anchors are marks in the document being edited, so a revision
renders them natively. Resolution is for a reader reconstructing what a child points at.

## Two creation experiences, kept separate

Revising an entry's own text and creating a child entry are modes that never mix in one sitting.
Text mode is ordinary editing and cannot add anchors. Anchor mode (`DocumentEditor.vue`'s
`anchor-mode` prop) allows only select-then-comment/strike and proposing wording at the caret.

That makes "no child entry is destructive" hold by construction, for two independent reasons. A
`filterTransaction` guard (`isAnchorEdit`, `editor/anchorCommands.ts`) rejects everything in anchor
mode except the anchor commands and undoing them. And `docToPlainText` is blind to what those
commands produce — marks aren't text, and it skips `anchorInsert` — so `sameContent(before, after)`
holds for any anchor-mode session.

An anchor-mode session edits two documents and seals atomically, via `EntryRepository.createMany`,
into a parent revision (`revision_mode: 'anchor'`) and the child. If nothing was anchored, only the
child is written. `createMany` is all-or-nothing, so a revision whose anchors no entry explains, or a
child pointing at ids nothing carries, is never representable. `revision_mode` is a real column
because a card's revision count reads only `'direct'` revisions.

**Annotation vs update is derived at seal time.** `relationTypeForAnchors` (`domain/anchors.ts`)
reads the anchors the session placed: a `strike` or proposed wording makes an `update`; only
`comment`s, or no anchors, make an `annotation`. So `DraftTarget`'s `new_child` carries no
`relation_type`.

**Before sealing**, a session may reopen, switch, or remove the anchors it placed (AUTHORING.md,
"Drafts", says how it knows which). **After sealing, anchors are fixed** — append-only, like entries.
Reopening a sealed child's anchors would be ordinary document steps on the parent and is possible in
principle, and decided but not built (PRODUCT.md §5.4); it, not overlap, is the intended way to say something
different about an anchored passage.

**Color.** Never stored. It is computed at render time from the active scheme, the child, and the
kind, so swapping schemes never touches history. The only scheme built is by kind
(`--color-anchor-*` in `src/assets/main.css`); others are in PRODUCT.md §6.

**Warning on an affected anchor.** A revision warns when the text _under_ an anchor changes —
insertion inside it, partial or full deletion or replacement — not when an edit elsewhere merely
shifts it, including typing against its edge. It is judged from ProseMirror's step maps, not by
comparing text: `mapAnchorSpans` (`editor/anchorCommands.ts`) checks each step's replaced range
against the anchor as it stood before that step, and `changesInside` (`domain/anchorWarnings.ts`) is
the pure judgment. Length comparison was tried first and missed a same-length paste. Tracking is
sticky for the session, and `EntryDetailView.vue` names each affected note before saving.

## Version chains

Each entry owns a linear chain: its own content is version one, frozen at creation, and its
revisions are versions two onward. Current state is the last version at or before the viewing time,
a plain fold. A revision's parent may not itself be a revision. Branching would need concurrent
multi-device edits, which is out of scope. A subtree's activity stream is derived by merging child
chains on timestamp.

Every link carries `content`, the resulting document snapshot, and `authoring_trace`, how it was
typed — identically for an entry and each of its revisions.

A revision is a full-state snapshot of `VersionedFields` — content, media, metadata, title, dates
and their notes, location, original medium and its note — not content alone, or revising would drop
images. `Entry`, `EntryVersion`, and `AggregatedEntry` all extend it, so the revisable fields are
declared once. The edit surface seeds from the current aggregate, never a raw row, which is how a
revision that only rewords carries everything else forward. Snapshotting is also what makes a title
or date correctable: the old value stays with its version. `created_at` is the ledger's own stamp
and is never correctable.

`media_refs` is **derived from the document** (an image is a node carrying a blob id), so it can't
drift from it.

## Connections

A connection is a directional edge: `parent_id` is the source, `target_id` the destination. It is
named like any entry (`entryLabel`, `utils/format.ts`), with no relation vocabulary of its own, and is
created through the full composer (`NewConnectionView.vue`). Both endpoints surface it, gathered by
`parent_id === id || target_id === id` and marked `outgoing` or `incoming`.

**`parent_id` alone defines containment; `target_id` is gathered but never traversed.** Walking
`target_id` as if it were a parent breaks three things: a note on a connection folds into both
endpoints and counts twice; connections chain, so the walk can cycle, and a visited set makes the
result depend on traversal order; and "an entry's subtree" stops being well defined. So a
connection's children belong to the connection.

## Imports

**An import produces media, not entries.** Scans land in the media store as an unfiled queue, and
each becomes an entry only through a deliberate act where the user supplies context and dates. That
settles `created_at` for imports: it is when the record entered Chronicle, so a batch shares one,
and sorting by when things happened is what `occurred_at` and `recorded_at` are for. Within a batch,
order falls to the id tiebreak — arbitrary but stable.

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
  authoring_trace: AuthoringTrace | null
}
```

| relation      | parent_id | target_id   | writes parent content | children |
| ------------- | --------- | ----------- | --------------------- | -------- |
| `null` (root) | null      | null        | is the base state     | yes      |
| `annotation`  | required  | null        | never                 | yes      |
| `update`      | required  | null        | never                 | yes      |
| `connection`  | source    | destination | never                 | yes      |
| `revision`    | required  | null        | yes, last-wins        | no       |

**`id` is a UUIDv7.** `created_at` has millisecond resolution, so it isn't a total order; a v7 id
carries a millisecond timestamp in its leading bits, so ids sort correctly as plain text and every
sort tiebreaks on it. It beats ULID on being an IETF standard, and a sequence column would need
every storage adapter to agree on one owner. `crypto.randomUUID()` emits only v4, so generation is a
small helper.

**`title` is a plain field beside the document**, folded through the version chain like the dates,
and never parsed out of `content`. It is edited in an `<input>`, not as a node in the document,
which makes it immune to the toolbar, `## `, and paste by construction. It produces no steps, so it
is absent from the authoring trace. **It is never required**: the untitled case is the ordinary one.
Surfaces with room for both text and title show the title only when there is one; one-line surfaces
fall back to `entryLabel`.

**The two user-supplied dates are days, not instants**, each with a free-text companion.
`YYYY-MM-DD` because a person entering a 1994 entry knows the day, and an instant would invent
precision and shift the day across timezones. Whatever precision exists goes in `*_time_note`,
unparsed until something sorts by it. The notes are columns rather than `metadata` even though
nothing queries them yet, since a note split from the date it qualifies makes every reader look in
two places.

**`location` and `original_medium` are small vocabularies the author grows**, stored as plain
strings. A location is a reusable name, not coordinates; `original_medium` says what an entry was
first written in, and is mostly null. The picker's options are the distinct values already in use,
so they can't drift from the data. They are separate fields rather than tags because where and what
it was written in are different questions from topic; if tags arrive and this proves wrong, they
collapse into tags.

**`authoring_trace` is null when typing was not captured**: imports, seeds, fixtures, and
programmatic creation.

**`metadata` holds only what neither drives logic nor gets queried** — an import's source filename,
the originating app version. Anything filtered, sorted, or joined on graduates to a column;
`original_medium` already has, and tags are the likeliest next.

**There is no `type` or `content_format` field.** An entry with an image is a document containing an
image node; a display kind is derived when needed. `content` is always a serialized document.

## Aggregate

Children are exposed as collections, never concatenated into the parent's text, which would make
anchoring impossible and `content` at a given time untrue.

```ts
interface AggregatedEntry extends VersionedFields {
  id: string
  created_at: string
  // VersionedFields are this entry's OWN state at asOf, folded from its version chain.
  version: { index: number; total: number; at: string; revision_id: string | null }
  children: ResolvedChild[] // annotations and updates, in created_at order
  connections: ResolvedConnection[]
}

interface ResolvedChild {
  entry: AggregatedEntry
  relation_type: RelationType
  anchors: ResolvedAnchor[] // this child's anchors, read out of the parent's current document
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

- **Yjs or another CRDT for content.** Character-level history and near-free sync, but the history
  becomes the library's rather than the app's — the exact thing this project exists to demonstrate.
- **A separate events table with materialized entries.** The entry log already is an event log.
- **Links, or revisions, in their own tables.** A link row couldn't carry prose, be revised, or take
  children; a revision table would cost the unified `Entry` and revisions in filtered timelines.
- **ProseMirror block ids as anchors.** Node attributes duplicate on split and vanish on merge, and
  give paragraph granularity where users want a sentence.
- **Anchors as offsets stored on the child**, resolved by a fallback ladder (exact position, mapped
  through steps, quote search, orphaned). Every failure traced to one cause — a fact about the
  parent's document stored somewhere else — and moving anchors into the parent deleted the ladder.
