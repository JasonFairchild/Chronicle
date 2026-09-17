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

A child entry doesn't store where it points — the parent's own document does. A stored anchor's
position is a fact about the _parent's_ document, not the child that references it, so it lives
there: a span op (`comment`, `strike`) is a **mark** on the parent's text, carrying `{ anchor_id,
kind }`; a collapsed op (an inserted word or phrase, including a strike's replacement wording) is an
**atom inline node**, `anchorInsert`, carrying `{ anchor_id, text }` — a mark can't represent a
zero-width position with content of its own, so a collapsed op needs the node form ProseMirror
already gives `MediaImage`. `anchor_id` ties a mark and a node together as one op, and is what pairs
wording with the mark it belongs to — a strike plus its replacement, or a highlight plus an inline
comment — sharing one `anchor_id` _is_ the pairing, declared rather than inferred from render-time
proximity or from which kind of mark it happens to be: `pairableAnchorAt` (`domain/anchors.ts`)
derives it from whichever anchor mark this session placed immediately before the caret, comment or
strike alike, never asking which. The mark is `inclusive: false`, so typing at an anchor's edge is
not silently absorbed into it, and `excludes: ''`, so adding one anchor's mark can never silently
strip a _different_ anchor's mark sharing the same span — a mark type excludes itself by default,
which would do exactly that. Anchors themselves stay exclusive at the command level instead
(`markAnchor`, `editor/anchorCommands.ts`): a selection touching an existing anchor's marked passage
at all, sealed or this session's own, never places a new one over it.

There is deliberately no `replace` op. Since nothing a child does hides the parent's text, "I would
have written this differently" is a strike over the original plus an `anchorInsert` of the new
wording sharing its id, both placed in one anchor-mode session so they stay grouped under one
explanation. A replace op would be sugar for that pair while implying a hiding behavior the model
does not have.

**What the child stores.** `anchors: AnchorRef[]`, each `{ anchor_id, quote }` — an id referencing a
mark/node in the parent's current document, plus the wording it covered when the child was sealed.
An empty list means the child is about the parent at large. `quote` is not a growing history, since
the parent's own step chain already is that history; replaying it to derive original wording is a
future upgrade once Phase 3 can replay chains, not a storage commitment now. It is what lets an
orphaned anchor (its mark removed by a later revision) still render "was attached to: …" once
nothing in the current document matches its id.

**Where wording lives.** The parent's document holds anchor structure and any wording that has a
position in the parent (an insert's text, a strike's replacement); the child holds the prose
explanation. Per-op commentary is not a separate field — it's another child entry. Batching several
ops under one explanation stays available; splitting one per child is the common case, not a rule.
Inline wording is plain, single-line text with no formatting; a thought needing more is prose and
belongs on the child. `docToPlainText` skips anchor-carried wording, so previews and search never
fill up with words the parent's author didn't write.

This subsumes the annotation/update distinction structurally. An entry carrying a strike plus an
insert behaves like an update; one carrying a bare comment behaves like an annotation. The
difference falls out of what the user did rather than a type chosen up front. `annotation` and
`update` survive as a **label** driving icons, defaults, and filtering, never branching domain logic.
Keeping them costs nothing and they cannot be backfilled if they later matter. Only `connection` and
`revision` are structural.

## Anchor resolution

Resolving an anchor is reading structure a general-purpose editor already maintains, not
reinterpreting stored offsets. `resolveAnchors` (`src/domain/anchors.ts`) walks the parent's current
document for a mark or node carrying each requested `anchor_id`: found means `present`, and the
document itself is the authority on what it covers now; not found means `orphaned`, and the child's
own recorded `quote` is what renders as "was attached to: <quote>" — breakage stays legible history
rather than silent loss. There is no ladder of degrees between those two, because there is no
position to have drifted: the mark either survived the parent's edits or a revision removed it.

Live editing needs no resolution pass at all. Because anchors are marks in the very document being
edited, a text-mode revision renders them natively while the author works, the same way any other
formatting mark would show. Resolution is what a **reader** (a different version, or someone else's
view) does to reconstruct what a child points at without live editor state to lean on.

## Two creation experiences, kept separate

Revising an entry's own text and creating a child entry are different modes a user cannot mix in one
sitting. Text-mode gets ordinary editing and cannot add anchor marks; anchor-mode
(`DocumentEditor.vue`'s `anchor-mode` prop) gets a sharply limited action set — select then
comment/strike, or place the cursor and propose wording — and cannot touch surrounding text at all.

This makes "no child entry is destructive" checkable, not just true by convention: an anchor-mode
session's `sameContent(before, after)` holds, and it holds by construction rather than by
convention, for two independent reasons. A `filterTransaction` guard (`isAnchorEdit` in
`editor/anchorCommands.ts`) rejects every transaction in an anchor-mode session except the anchor
commands below and undoing them, so surrounding text is unreachable at the editor level before the
question of what counts as "content" even comes up. And within what those anchor commands _can_
produce, `docToPlainText` is blind to both shapes: a mark is metadata riding on existing text, which
the flattening never reads at all, and an `anchorInsert` node is a real node with real text that
`docToPlainText` is specifically required to skip (see "Where wording lives" above).
`revision_mode: 'direct' | 'anchor' | null` is a real column on `Entry`
(not `metadata`, since it's filtered on: a card's revision count reads only `revision_mode ===
'direct'` revisions, so an anchor-mode session's parent revision doesn't inflate it).

**`annotation` vs `update` is derived at seal time, never asked.** `relationTypeForAnchors`
(`domain/anchors.ts`) reads the anchors a session placed out of the parent's document: a `strike`, or
an `anchorInsert` proposing wording, reports a correction and makes the child an `update`; anchors
that only `comment` claim nothing changed and make it an `annotation`; no anchors at all is an
`annotation`, the quieter claim. This is why `DraftTarget`'s `new_child` carries no `relation_type` —
an unsealed draft has not settled the question, which is also why the drafts list calls one a
"related entry" rather than naming a kind it would sometimes get wrong.

**Drafts.** An anchor-mode session edits two documents — the parent (gaining provisional anchors,
tracked in `Draft.parent`, an `AuthoringBuffer` plus the `base_content` described below) and the
child's own prose (`Draft.child`, an `AuthoringBuffer` on its own) — sealing atomically into two entries
via `EntryRepository.createMany`: a parent revision (`revision_mode: 'anchor'`) and the child
(`anchors` pointing at what just landed). A draft also holds the dates typed beside the words
(`Draft.dates`), so a reload loses neither. `createMany` writes all-or-nothing, so a half-sealed
pair — a revision whose anchors no entry explains, or a child pointing at ids nothing in the parent
carries — is never representable. If nothing was actually anchored, sealing writes only the child,
exactly as it would for an unanchored note — no revision for a parent nothing touched.

`title` sits beside `child` at the top of `Draft`, the same way `dates` does, rather than inside
`AuthoringBuffer`: only the child's title is ever writer-set, so there is nothing for it to do
living in a shape meant for two independently-authored documents. `Draft.parent`'s own `title` is a
different thing entirely — the parent's title as it stood when the session began, mirrored there
once purely so a resumed anchor-mode session can display it without a second fetch. Sealing never
reads it: `sealAnchorChild` (`stores/entriesStore.ts`) forwards the freshly aggregated `current.title`
for the parent's own revision, since anchor mode offers no way to retitle a parent in the first
place.

Anchors may be freely added, changed, or undone before that seal. **Which ids this session may still
change** is never stored as a list at all — it is the _difference_ between two documents:
`Draft.parent.base_content`, the parent exactly as this session found it, set once and never
rewritten, and `parent.content`, the parent as it stands right now. `anchorsPlacedSince(base,
current)` (`domain/anchors.ts`) reads that difference on demand, which is what lets a
placed-then-undone anchor leave no trace to subtract without a second record to keep in step with
the document. Persisting the _base_ rather than a running list of ids is also what survives a
resume: a reload reseeds the editor from `parent.content`, which already carries whatever this
session placed before the reload — indistinguishable from an earlier child's sealed anchor unless
something fixed predates the session to compare against. The base is that fixed point; it is also,
not incidentally, the version the session started revising from, which a future check for "this
draft has gone stale against a parent revised elsewhere" (CHRONICLE_PLAN.md) would compare against
too.

Editing reaches only what a session placed and hasn't sealed yet: reopen an anchor's wording box by
clicking it (its marked passage or its wording), switch it between highlight and strike, or remove it
outright — all ordinary document steps captured the same way any other edit in the session is. A
fresh selection may never overlap an anchor already in the document, sealed or this session's own
(`markAnchor`, `editor/anchorCommands.ts`) — touching a sealed one does nothing at all, since only the
child that placed it may still change it.

**No editing or deleting an anchor once sealed** — append-only for the parent's anchor history, same
as entries generally. Pointing differently at the same passage later means adding another child entry
today. Re-opening a _sealed_ child's anchors is possible in principle (they'd be ordinary document
steps on the parent too, captured the same way a revision is) but is deliberately not offered yet —
see PRODUCT.md's Future Considerations. That, not reintroducing overlap, is the intended way to say
something different about an already-anchored passage once it's built.

**Color.** Never stored — the mark/node carries only `{ anchor_id, kind }`. Color is computed at
render time from `(active scheme, child entry, kind)`, so a scheme can be swapped without touching
history: a system scheme by op kind (the default, and the only one built today — see
`--color-anchor-*` in `src/assets/main.css`), a per-child scheme assigned by a child's stable ordinal
among its siblings, user-defined palettes, or a pinned color on one child overriding the scheme. One
color per child, not per op, matching "one set of ops is usually one thought." A tag-linked scheme is
a plausible future fourth option once tags exist as a real entity — see PRODUCT.md, "Making anchor
ops unmistakable" — coloring the tag rather than the child, so an anchor on a tagged entry can adopt
it. Not decided; noted here only so the render-time-only rule above is understood to already
accommodate it.

**Warning on an affected anchor.** Warn when the _text under_ an anchor changes — insertion inside
its range, partial or full deletion — not when it merely shifts from an edit elsewhere. Detected by
mapping each anchor's endpoints (`anchorSpans` / `mapAnchorSpans` in `editor/anchorCommands.ts`) through
the pending session's `Mapping` and reading ProseMirror's own deletion flags (`deletedAfter` on the
start, `deletedBefore` on the end), not by comparing text; `anchorsAffectedBy`
(`domain/anchorWarnings.ts`) is the pure judgment on top. Tracking runs one transaction at a time for
the length of the session, sticky once an anchor is flagged, and `EntryDetailView.vue` names the note
each affected anchor belongs to before "Save revision" is offered.

**Superseded by this design:** the offset-and-quote `AnchorOp`/`DocLocation` shape that used to live
on the child, and `resolveAnchor.ts`'s four-status ladder (`stillHolds`, `mapLocation`,
`findByQuote`, `findCollapsed`, `isReplacementPair`) built to reinterpret it — both deleted once
anchors became native to the parent's document rather than numbers requiring a ruler and a fallback
search. See "Considered and rejected" below for why that shape was worth trying and worth leaving.
`docToPlainText`, `collectMediaRefs`, and `isEmptyDocument` were unaffected by the move — they stayed
for previews, search, and validation, just without being safety-critical for anchor offsets anymore.

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

A revision is a full-state snapshot of `{ content, media_refs, metadata }` plus the author-supplied
fields below (`title`, the two dates and their notes, `location`, `original_medium` and its note) —
not content alone, or revising an entry silently drops its images. In code that group is named
`VersionedFields`, extended by `Entry`, `EntryVersion`, and `AggregatedEntry` alike, so the fields a
revision may change are declared in exactly one place. The edit surface seeds from the current
aggregate state, never a raw stored row, which is also how a revision that changes only wording
carries everything else forward unchanged. A revision's parent may not itself be a revision.

Snapshotting those fields rather than reading them off the entry's row is what makes them
correctable: changing a date — or a title — is an ordinary revision, the value it replaced stays on
record with the version it belonged to, and scrubbing to an earlier version shows what the entry was
called then. `created_at` is the exception and stays untouchable, being the ledger's own stamp
rather than anything a person said.

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
`{ at, step_index, reason }` with reason `pause | punctuation | interval | format | anchor | manual`,
all tunable. A pause or a sentence-ending period appends a bookmark; it does not trigger a write,
because the writing already happened. A trace belongs on any entry that was typed, not only
revisions, so a first draft is captured the same way as a later edit.

One policy judges every stream the same way: the parent's provisional document in an anchor-mode
session and the child's own prose are two `AuthoringSession` instances, not two mechanisms — anchor
mode limits what the _editor_ can produce (see "Two creation experiences, kept separate" below), not
how the session records what it does produce. `anchor` is a one-shot structural op — placing an
anchor, switching it between highlight and strike, or removing it (`editor/anchorCommands.ts`'s
`ANCHOR_TICK_META`) — never a keystroke inside an open wording box: typing wording is typing, and it
earns a bookmark the way prose does, from `pause`, `punctuation`, or `interval`, not from being the
last keystroke before Enter. That last part isn't a policy choice so much as a fact about the editor:
every keystroke there already writes straight through to the document (`updateAnchorInsertText`), so
by the time a box is committed the value is already in place and the commit's own transaction is a
content no-op TipTap won't even emit an update for — there is no separate "settling" moment to tick.

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
interface AuthoringBuffer {
  content: string
  steps: AuthoringStep[]
  ticks: AuthoringTick[]
}

interface Draft {
  session_id: string
  target:
    | { kind: 'new_root' }
    | { kind: 'new_child'; parent_id: string } // anchor-mode
    | { kind: 'new_connection'; parent_id: string; target_id: string }
    | { kind: 'revision'; parent_id: string } // text-mode
  started_at: string // shared by child and parent — one session, two documents
  updated_at: string
  dates: EntryDates
  title: string | null
  child: AuthoringBuffer // the entry this draft is chiefly for
  parent: (AuthoringBuffer & { base_content: string; title: string | null }) | null
}
```

Sealing turns one draft into one or two entries, per "Two creation experiences" above: `new_root`
and `revision` each become one entry, carrying `child.content`/`.steps`/`.ticks` into it as
`authoring_trace`; `new_child` becomes the child alone when nothing was placed since
`parent.base_content` (`anchorsPlacedSince`), or the atomic parent-revision-plus-child pair when
something was, with `parent.content`/`.steps`/`.ticks` sealing into the revision's own
`authoring_trace`. Either way the draft row is deleted once its contents live in a committed entry. A
draft is therefore very nearly the entry (or entries) it will become, which is exactly why it must
not live in the entries table. Entries are immutable and a draft rewrites itself
every few hundred milliseconds. Keeping them apart means no entry query ever has to filter drafts
out, and a half-written thought never appears in history or a timeline. The `target` field is what
lets an unsealed draft know what it will become, so the drafts list can show what each one is
attached to.

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

Connections are directional edges, not children. Direction is meaningful and gets leaned into: the
arrow names the entry at the other end the same way any entry is named elsewhere (its title, else a
preview of what it says — `entryLabel` in `utils/format.ts`) — there is no connection-specific label
field, no vocabulary of its own for "how they relate." A connection is created through the same
full-entry composer as anything else (`NewConnectionView.vue`), just with a destination attached.
The destination is not blind to the edge: both endpoints surface it, gathered by union on
`parent_id === id || target_id === id` with an `outgoing`/`incoming` marker.

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

**The title is a plain field beside the document, folded through the version chain like `location`
or the dates.** It rides in `EntryVersion` and `AggregatedEntry` next to them, and a revision that
renames an entry carries it forward exactly the way it carries forward a date it isn't correcting —
see "Revisions" above. `Entry.title` is the one place it lives: never a cache of something else,
never re-derived by parsing `content`.

This was not always so. Title used to be a node at the head of the stored document — present or
absent, with or without text — joined onto the body on the way to storage and split back off on the
way out, with `Entry.title` a cache written at save time for readers that must not parse a document.
The editor's own schema never had a title node in it either way: a title was always a plain `<input>`
beside the editing surface, because the alternative — a dedicated node inside the one contenteditable
region the toolbar acts on — needed a `filterTransaction` guard to stop `setHeading` from swapping it
out, custom Enter and Tab handlers to get the caret across the boundary, and a node kept out of the
`block` group so a second one couldn't appear further down. Each guard was correct; all of them
together were a list of ways to reach a title the design should never have offered, and an `<input>`
is immune to a toolbar button, a `## ` shortcut, or a paste by construction.

Pulling the title out of the stored document as well cost nothing a revision's document-snapshot
model was already relying on: a title produces no ProseMirror steps regardless of where it's stored,
so it was always absent from the authoring trace and invisible to the tick policy
(`draftsStore.recordChange` skips a change with no steps) — its history was always the coarser one,
the value at each save point, which `EntryVersion.title` gives for free now that it's an ordinary
folded field. What it did buy: `docToPlainText` no longer has a title node to skip, `entryDocument.ts`
has no join/split pair to keep symmetric, and the authoring trace's steps are relative to the same
document that gets stored — no more "short by the title node's length" offset for a future replay to
account for.

**A title is never required.** Not on a root entry, not on a connection. `Entry.title` is nullable
and genuinely so — the untitled case is the ordinary one, not an edge.

This was briefly the other way, and the argument for requiring one was that lists need a handle.
It does not survive contact with a daily journal: most of what gets written would only ever be
named "Tuesday", and a mandatory field does not produce better names, it produces filler that makes
the list it was meant to protect harder to read. Nor does requiring a title let any code go — an
untitled entry is still routine even where a title is offered, so every untitled-rendering path has
to exist and work either way. What the rule bought was a save button that refused, and nothing else.

So a title is an affordance, offered wherever it makes sense and skipped without comment. In
practice every composer offers it (`DocumentEditor`'s `with-title`) — `EntryForm`, `RelatedEntryComposer`,
`NewConnectionView`, and a revision or a resumed draft all show the field, since whether to name an
entry is a choice the author should always have, not one settled once and then withheld. Naming an
entry that stayed unnamed falls to `entryLabel` (`utils/format.ts`): the title if it has one,
otherwise the opening of what it says. Surfaces with room for both — a timeline card, the detail
header — show the title only when there is one rather than falling back, since the text is already
on screen and a fallback there would print it twice. The detail header uses the creation date
instead, which is the half every entry has and the half that does not move.

**The two user-supplied dates are days, not instants, and each has a free-text companion.**
`created_at` is a full timestamp because the ledger sets it. `recorded_at` and `occurred_at` are
`YYYY-MM-DD`: a person entering a journal entry from 1994 knows the day, and storing midnight as an
instant would both invent a precision nobody gave and move the day itself across timezones. Whatever
precision does exist goes in `*_time_note` as text, because "morning", "after dinner" and "3:30 pm"
are equally valid answers and none of them is worth parsing until something sorts by it.

Those notes are columns rather than `metadata` despite nothing querying them today, which is the one
place that rule is knowingly bent. A note is meaningless apart from the date it qualifies, so
splitting the pair across a column and an open bag would make every reader look in two places; and
the likely next step for both — ordering the timeline by when things happened — is exactly the
graduation the rule describes, with real journal data already entered by then. All four fields are
required and nullable, like everything else on `Entry`, never optional: this is pre-users, so there
is no row predating them to tolerate, and there will not be a code path for one until real data
needs to survive a shape change (CLAUDE.md, "No backward compatibility until we deliberately decide
it's needed"). A revision carries them, so the aggregate reads them from the current version rather
than the entry's own row — see "Revisions" above. The model supports correcting a date; no UI offers
it yet (PRODUCT.md §5.3).

**`location` and `original_medium` are small vocabularies the author grows, not free text and not a
taxonomy.** Location is a name a person reuses — "home", "grandma's" — not coordinates: the question
a journal asks of a place is which one it was, and a lat/long answers a question nobody posed while
losing the one that matters. `original_medium` records what an entry was first written in — a paper
journal, Google Docs, a voice memo — which only means anything for imports and for entries a person
recreates here from somewhere else; most entries leave it null. `original_medium_note` qualifies it
the way a `*_time_note` qualifies a date ("blue Moleskine, 2014-2016"), and is a column for the same
reason: a note split from the thing it describes makes every reader look in two places.

Both are stored as plain strings, with the select's options derived from the distinct values already
in use rather than kept in a vocabulary table. For one person the list stays coherent on its own,
and deriving it means the options can never drift from the data — the same reconstruct-don't-store
reasoning the rest of the model runs on. A vocabulary table earns its place when renaming a value
across every entry that carries it becomes worth doing, and that rename is itself a correction, so
it would want the revision mechanism above rather than an UPDATE.

They are separate fields rather than tags, though a user-defined single-select is close kin to one.
Two reasons: filtering by where something happened is a different question from filtering by topic,
and a tag list that has to carry places and media alongside subjects gets noisy enough that none of
the three is easy to find. If tags arrive and this turns out wrong, the fields collapse into them.

**`authoring_trace` is null when typing was not captured, never because an entry lacks content.**
Imports, seeds, test fixtures, and programmatic creation all produce a null trace. Whether a
user-facing switch for disabling capture should exist is a later product question.

**`metadata` holds only what neither drives domain logic nor gets queried:** the mechanical residue
of an import such as a source filename or row number, originating device or app version, a pinned or
color flag. The rule is that anything filtered, sorted, or joined on graduates to a real column.
Without it, an open bag becomes where columns hide, unindexed and unvalidated. `original_medium` is
the graduation already taken — what an import came _from_ is something a person filters by, unlike
the bookkeeping of which file it arrived in. Tags are the likeliest next one. Ambient data such as
weather belongs in a third-party overlay, not here.

**There is no `type` field and no `content_format` field.** An entry with an image is a document
containing an image node, not a different kind of entry, and with no data to migrate every entry is a
document from the start. A display kind for icons and filtering is derived when needed.
`original_medium` is not a quiet return of `content_format`: it records where the writing lived
before Chronicle, and nothing reads it to decide how to parse or render `content`, which is always a
serialized document whatever the entry was first written on.

## Aggregate

Children are exposed as collections, never concatenated into the parent's text. Concatenation would
make anchoring impossible and would make `content` at a given time untrue.

`VersionedFields` is the eight fields a revision replaces as a full-state snapshot (see "Version
chains" above): `dates`, `location`, `original_medium`, `original_medium_note`, `title`, `content`,
`media_refs`, `metadata`. `Entry`, `EntryVersion`, and `AggregatedEntry` each extend it, so the group
is named once rather than repeated per shape.

```ts
interface AggregatedEntry extends VersionedFields {
  id: string
  created_at: string
  // dates, location, title, content, etc. are folded from the version chain, like content —
  // this entry's OWN state at asOf, not concatenated with its children's.
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
- **Anchors as offsets stored on the child**, resolved by a fallback ladder (exact position, mapped
  through recorded steps, quote search disambiguated by prefix/suffix, then orphaned). Worth
  building first: it needed no editor schema change and proved the shape of the problem. But every
  one of its failure modes traced back to the same cause — an offset is a fact about the parent's
  document, stored somewhere that isn't the parent's document — and the fallback ladder existed
  entirely to paper over that. Moving anchors into the parent as marks and nodes (above) deleted the
  ladder rather than improving it: there is nothing left to fall back from.
