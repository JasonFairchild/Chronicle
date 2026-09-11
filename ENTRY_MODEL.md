# Chronicle Entry Model

How entries relate, how they change over time, and how a child entry points at part of its parent.
See [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md) for the product concept and phased plan.

A child entry is not a note stapled to a parent. It is a set of **operations on specific places in
the parent**, grouped under one explanation. That idea drives most of what follows.

## Two invariants

**No child entry is ever destructive.** A parent's stored text is never altered by its children.
Strikes and insertions are presentational. Content changes only through the version chain.

**Timeline membership is a view filter, not a model fact.** Any entry may appear in a timeline
subject to user preference. Revisions in a filtered timeline, showing how often something was
reworked, is a legitimate view. Ticks are not entries and so never appear.

## Child entries and anchors

A child carries a list of anchored operations, each with its intent. An empty list means the child
is about the parent at large.

```ts
type AnchorOp =
  | { kind: 'comment'; at: DocLocation } // highlight and remark on
  | { kind: 'strike'; at: DocLocation } // shown struck, never hidden
  | { kind: 'insert'; at: DocLocation; text: string } // collapsed location
  | { kind: 'media'; media_ref: string }

interface DocLocation {
  from: number // ProseMirror positions, relative to base_version_id
  to: number // === from for an insertion point
  base_version_id: string | null // the version these positions were measured in; null = version one
  quote: string // the spanned text; '' when collapsed
  prefix?: string // text just before, for disambiguation
  suffix?: string // text just after
}
```

One location type serves every op, including insert. An insertion point is a collapsed location
where `from === to`, so it inherits the same migration and fallback machinery as a span rather than
needing its own.

`prefix` and `suffix` are the disambiguating context for fallback matching. If the quote is "the
meeting" and that phrase appears four times in the document, the quote alone cannot say which one
was meant, and a short run of text on either side pins it. For a collapsed insertion point the quote
is empty, so prefix and suffix are the only fallback signal there is.

There is deliberately no `replace` op. Since nothing a child does hides the parent's text, "I would
have written this differently" is a strike over the original plus an insert of the new wording, both
in one child entry so they stay grouped under one explanation. A replace op would be sugar for that
pair while implying a hiding behavior the model does not have.

Pairing is inferred at render time, not stored. When one child holds a strike and an insert whose
location falls inside or adjacent to that strike, they draw as a unit: struck original followed by
the new wording styled as an addition, the familiar diff shape. Anything else draws separately. A
strike with no accompanying insert is meaningful on its own, a retraction, and renders as struck
text with a gutter marker leading to the child entry whose prose explains it. The fallback when the
heuristic does not fire is drawing both ops independently, which is always correct if less pretty.

This subsumes the annotation/update distinction structurally. An entry carrying a strike plus an
insert behaves like an update; one carrying a bare comment behaves like an annotation. The
difference falls out of what the user did rather than a type chosen up front. `annotation` and
`update` survive as a **label** driving icons, defaults, and filtering, never branching domain logic.
Keeping them costs nothing and they cannot be backfilled if they later matter. Only `connection` and
`revision` are structural.

## Anchor resolution

Anchors are document positions with a recorded base version, plus quoted text.

Positions alone are meaningless without knowing which version they were measured against, hence
`base_version_id`. Because editor steps are recorded anyway for authoring history, an anchor can be
**migrated exactly** through later edits by mapping its positions forward through those steps, rather
than guessed at by text search. Quote text is kept for two reasons: it is the fallback when the step
chain is unavailable, and it is the human-readable record of what the passage originally said.

Resolution returns `exact`, `mapped`, `fuzzy`, or `orphaned`. An orphaned anchor renders as "was
attached to: <quote>", so breakage is legible history rather than silent loss.

## Version chains

Each entry owns a linear chain: its own content is version one, frozen at creation and never
rewritten, and its revisions are versions two onward. Current state is the last version at or before
the viewing time. Stringing several revisions over the same passage is a plain fold, since each
revision's base is the one before it. Branching would need concurrent multi-device edits, which is
out of scope.

A whole-subtree activity stream is derived by merging child chains on timestamp, so both the
per-entry and the whole-tree views exist while only one is stored.

**Every link in a chain carries the same two fields doing the same two jobs.** `content` is the
resulting document snapshot; `authoring_trace` is the record of how that snapshot was typed. This
holds identically for an entry and for each of its revisions, which is what makes the chain uniform.
A revision's content is a real snapshot, not a trace.

A revision is a full-state snapshot of `{ content, media_refs, metadata }`, not content alone, or
revising an entry silently drops its images. The edit surface seeds from the current aggregate
state, never a raw stored row. A revision's parent may not itself be a revision.

`media_refs` is **derived from the document**, not maintained alongside it: an image is a node
carrying a blob id, so the document is the authority on what it depends on and the column cannot
drift from it. The carry-forward rule above applies to legacy plain text, which has no nodes to
derive from and so keeps the previous version's list.

## Authoring capture

Sessions are captured as an operation chain, not as repeated documents. A ProseMirror document is an
immutable node tree with integer positions, and every edit is a transaction holding one or more
**steps**, the smallest serializable description of a change. Deleting a word mid-paragraph is one
step of roughly 45 bytes rather than a fresh copy of the document, and a formatting action is
captured inherently rather than by a special rule.

Four properties make steps the right unit: they serialize to plain JSON and back, they apply to
produce the next document, they invert so you can scrub backwards, and a sequence of them builds a
mapping that relocates a position from an old document into a new one. That last property is what
makes exact anchor migration possible.

The session's end state is stored as a full snapshot and is authoritative. If a future editor schema
change ever makes old steps unreplayable, the loss is fine-grained scrubbing for that session, never
content.

**Durability and tick marking are separate jobs and should not be confused.** Persisting steps is
about never losing work, happens constantly and invisibly, and marks nothing. Tick marking is about
identifying moments worth stopping at when reviewing how something was written. Every step is
persisted; only some moments are bookmarked.

So ticks are not entries and are not saves. They are timestamped bookmarks into the step chain,
`{ at, step_index, reason }` with reason `pause | punctuation | interval | format | manual`, all
tunable. A pause or a sentence-ending period appends a bookmark; it does not trigger a write, because
the writing already happened. A trace belongs on any entry that was typed, not only revisions, so a
first draft is captured the same way as a later edit.

## Two stores, one of them history

The entries store is permanent and append-only and only ever receives finished, immutable entries. A
session in progress cannot write there, since that would mean rewriting one row repeatedly as the
user types, breaking the append-only rule, or creating thousands of rows nobody wants. So a live
session accumulates into a separate draft buffer keyed by session.

The buffer is **also append-only while the session runs**. Steps are appended as they happen and
nothing already written is rewritten, so no authoring history is lost by design. The only thing that
disappears is the buffer as a whole, deleted after sealing, once its contents already live in the
committed entry. It is durable rather than in-memory so a crash or a closed laptop costs nothing; on
next load the session resumes or seals as it stands.

Steps flush on a short debounce of a few hundred milliseconds, putting worst-case crash loss well
under a second of typing. This is autosave and it is unrelated to tick marking.

**Sealing is an explicit user action**, a save or import click, never an idle timeout. Until the user
seals, the work is a draft: durable, recoverable across reloads, and absent from timelines. Opening
an existing entry to revise it produces a pending revision draft the same way, leaving the entry
untouched until sealed. Because a draft can therefore live indefinitely, drafts need their own list
so none are stranded invisibly. Sealing writes one immutable entry holding the final snapshot and
the completed trace, then discards the buffer. The buffer is working space, not history, which makes
this an explainable exception rather than a quiet violation of the write rule.

## Drafts

The draft buffer is a real persisted store, not an in-memory one. That is the whole reason a crash
costs nothing: every debounced flush writes to disk through the same local-first persistence layer
the entries use, in its own `drafts` store.

```ts
interface Draft {
  session_id: string // key
  target:
    | { kind: 'new_root' }
    | { kind: 'new_child'; parent_id: string; relation_type: RelationType }
    | { kind: 'revision'; parent_id: string; base_version_id: string }
  started_at: string
  updated_at: string
  content: string // current document snapshot
  anchors: AnchorOp[] // ops being composed, for a child draft
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
}
```

Sealing turns one draft into one entry: `content` and `anchors` carry over, `steps` and `ticks`
become the `authoring_trace`, and the draft row is deleted. A draft is therefore very nearly the
entry it will become, which is exactly why it must not live in the entries table. Entries are
immutable and a draft rewrites itself every few hundred milliseconds. Keeping them apart means no
entry query ever has to filter drafts out, and a half-written thought never appears in history or a
timeline. The `target` field is what lets an unsealed draft know whether it will become a root, a
child of something, or a revision, so the drafts list can show what each one is attached to.

## Imports

**An import produces media, not entries.** A batch of scanned journal pages lands as blobs in the
media store plus an unfiled queue. Turning any of them into an entry is a deliberate act, one at a
time or through a review flow, where the user supplies context and fills in `occurred_at` or
`recorded_at`. Bulk-creating entries nobody has read would fill the timeline with unreviewed
records, and a curated personal history is the whole premise. Optical character recognition to
pre-fill a draft is a plausible future convenience and still ends in human review, so it changes the
drafting step rather than this rule.

That also settles what `created_at` means for imports. It is when the record entered Chronicle,
which for a bulk import genuinely is the import moment, so it stays meaningful rather than becoming
noise. Sorting by when things happened is what `occurred_at` and `recorded_at` are for, which is why
the model carries three dates. Within one import the shared `created_at` leaves ordering to the id
tiebreak, which is arbitrary but stable, and nobody cares about intra-import insertion order.

## Connections

Connections are directional edges, not children. Direction is meaningful and gets leaned into, with
an optional label rendering as an arrow. The destination is not blind to the edge: both endpoints
surface it, gathered by union on `parent_id === id || target_id === id` with an `outgoing`/`incoming`
marker.

**`parent_id` alone defines containment; `target_id` is gathered but never traversed.** Reconstructing
an entry needs to know which entries belong to its subtree, and it answers that by following
`parent_id` upward: an entry belongs to X if its parent chain reaches X. Surfacing a connection on
its destination is a separate top-level gather of rows where `target_id === X`, not a step in that
walk.

Treating `target_id` as parent-like inside the walk breaks three things at once. A connection C links
A to B, and an annotation N sits on C. N would then be reachable from both A and B, so it folds into
both aggregates and gets counted twice. Connections also chain, so a link from A to B plus a link
from B back to A makes the walk cycle; a visited set stops the infinite recursion but leaves the
result dependent on traversal order, which is worse than crashing. And once the shape is a graph
rather than a tree, "an entry's subtree" is no longer well defined, which takes depth-limited
rendering with it.

So a connection's children belong to the connection itself, not to either endpoint. Connections can
be annotated, revised, and have children like any other entry; they simply display differently.

## Fields

```ts
type RelationType = 'annotation' | 'update' | 'connection' | 'revision'

interface Entry {
  id: string // UUIDv7: time-ordered and sortable as text
  created_at: string
  recorded_at?: string | null
  occurred_at?: string | null
  parent_id: string | null
  relation_type: RelationType | null
  target_id: string | null // connections only
  title: string | null // cache of the document's title node
  content: string // serialized ProseMirror document
  anchors: AnchorOp[] // empty = about the parent at large
  authoring_trace: AuthoringTrace | null
  media_refs: string[] // OPFS blob ids the document depends on
  metadata: Record<string, unknown>
}
```

| relation      | parent_id | target_id   | writes parent content | children |
| ------------- | --------- | ----------- | --------------------- | -------- |
| `null` (root) | null      | null        | is the base state     | yes      |
| `annotation`  | required  | null        | never                 | yes      |
| `update`      | required  | null        | never                 | yes      |
| `connection`  | source    | destination | never                 | yes      |
| `revision`    | required  | null        | yes, last-wins        | no       |

**`id` is a UUIDv7, not a UUIDv4.** Random ids sorted by millisecond timestamps are not a total
order, so entries written in the same tick have undefined order, and true insertion order cannot be
recovered afterward. Every claim about history rests on this. Every sort tiebreaks on `id`.

UUIDv7 carries a 48-bit millisecond timestamp in its leading bits followed by randomness, so ids
generated in sequence sort correctly as plain text and the database index agrees with the JavaScript
comparison without special handling. ULID is the same idea from an independent 2016 spec, encoded
shorter at 26 characters. UUIDv7 wins on being an IETF standard with growing native database
support, and the shorter string is worth nothing here. `crypto.randomUUID()` emits v4 only, so
generation is a small helper. A sequence column looks simpler but needs an owner, so each storage
adapter would maintain one and they would have to agree.

**The title lives inside the document; the column is only a cache.** The editor schema puts an
optional title node first, so changing a title is an ordinary document step and lands in the
authoring trace for free, with no extra op kind and no second field to keep in sync. The column is
written at save time so timeline lists, search, and naming an entry from the far end of a connection
do not parse every document. It is never edited on its own. Child entries hide the title field and
leave it null; a revision leaves the _column_ null too, but its document keeps the title node, which
is what makes renaming an entry an ordinary edit rather than a special case.

Because of that, the aggregate reads the title from the current version's document and falls back to
the column. The fallback is what carries content written before the editor existed, which is plain
text with no title node to read. The schema makes the title optional, and an optional node is one
the editor never creates on its own, so an editor opened on a titled entry is handed an empty title
node when the document lacks one (`ensureTitle`) or the entries most in need of a name could never
be given one.

**`authoring_trace` is null when typing was not captured, never because an entry lacks content.**
Imports, seeds, test fixtures, and programmatic creation all produce a null trace. Whether a
user-facing switch for disabling capture should exist is a later product question.

**`metadata` holds only what neither drives domain logic nor gets queried:** provenance for imports,
originating device or app version, a pinned or color flag, and the connection label while its
vocabulary churns. The rule is that anything filtered, sorted, or joined on graduates to a real
column. Without it, an open bag becomes where columns hide, unindexed and unvalidated. Tags are the
likeliest first graduate. Ambient data such as weather belongs in a third-party overlay, not here.

**There is no `type` field and no `content_format` field.** An entry with an image is a document
containing an image node, not a different kind of entry, and with no data to migrate every entry is a
document from the start. A display kind for icons and filtering is derived when needed.

## Aggregate

Children are exposed as collections, never concatenated into the parent's text. Concatenation would
make anchoring impossible and would make `content` at a given time untrue.

```ts
interface AggregatedEntry {
  id: string
  created_at: string
  title: string | null
  content: string // this entry's OWN text at asOf
  media_refs: string[]
  metadata: Record<string, unknown>
  version: { index: number; total: number; at: string; revision_id: string | null }
  children: ResolvedChild[] // annotations and updates, in created_at order
  connections: ResolvedConnection[]
}

interface ResolvedChild {
  entry: AggregatedEntry
  relation_type: RelationType
  ops: ResolvedOp[]
  has_children: boolean // grandchildren are indicated, not expanded
}
```

Default depth is 2, matching the intent that a parent view shows immediate descendants prominently
and only signals that deeper ones exist.

## Considered and rejected

- **Yjs or another CRDT for content.** Gives character-level history and a near-free path to
  multi-device sync, but the history becomes the library's rather than the app's, which surrenders
  the exact thing this project exists to demonstrate.
- **A separate events table with materialized entries.** Two systems and double the code. The entry
  log already is an event log; what was missing was vocabulary, not machinery.
- **Splitting entries and links into separate tables.** Cleanly solves connection symmetry, but a
  link row is not an entry, so it could not carry its own prose, be revised, or take children.
  Keeping connections as entries preserves all of that, which is why the split lost.
- **Splitting entries and revisions into separate tables.** Revisions look like a weak entity, but
  separating them costs the unified-Entry identity and the option of showing revisions in filtered
  timelines.
- **ProseMirror block ids as anchors.** Node attributes are copied on paragraph split and lost on
  merge, so ids duplicate and orphan. Repairing that needs a custom extension that cannot be tested
  outside a browser, and it gives paragraph granularity where users want a sentence.
