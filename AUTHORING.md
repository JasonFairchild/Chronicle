# Chronicle Authoring

How a writing session is recorded, where it lives until it's saved, and how it is read back as marks and frames for the history view. The entries it seals into are [ENTRY_MODEL.md](./ENTRY_MODEL.md).

## Authoring capture

A session is captured as ProseMirror **steps**, not repeated documents. A step is the smallest serializable description of a change: deleting a word is one step of about 45 bytes, and formatting is captured inherently. Steps serialize to JSON, apply to produce the next document, invert, and compose into a mapping that relocates positions across documents.

The session's end state is stored as a full snapshot and is authoritative. If a schema change ever makes old steps unreplayable, what's lost is fine-grained scrubbing for that session, never content.

**Replaying a sealed trace from its `base_content` reproduces the entry's `content` exactly.** So every step the editor applies is recorded, including those a plugin appends (an autolink, the paragraph kept after a trailing heading). Steps a plugin appends to a transaction that changed nothing itself are scaffolding: `DocumentEditor` holds them for the writer's next change rather than starting a session with them. Replay (`editor/replay.ts`) uses the editor's own schema and stops at the first step that won't apply. A browser test in `DocumentEditor`'s specs holds the exactness.

**The trace is an event log.** `AuthoringTrace` holds `base_content`, the document the first event applies to, and `events` in order: an `edit` carries one transaction's steps plus the signals read off it (`ChangeSignals`); a `manual` event is a bookmark the writer asked for. `base_content` makes a trace replayable on its own, without recovering the start from a version chain that may have moved on. Each event's `at` is milliseconds since `started_at`; the recorder floors its clock at the last `at` used, across reloads too, so `at` never decreases but can tie. The log's order is the total order.

**Signals are stored, not re-derived.** Most need a replay to derive: `removed_chars` is measured against the document before each step; `is_formatting`, `is_anchor_op` and `media_changed` compare before and after; `is_paste` isn't in the steps at all. `inserted_text` is readable from step JSON, but storing it keeps marks working even if a schema change makes steps unreadable. Signals are stored sparse — a missing one reads as false, `0` or `''` — since all six would add about 120 bytes to a keystroke's 85.

**Signals are outcomes, not provenance.** `is_anchor_op` is set iff the document's set of anchor ids and kinds changed (`contentDelta`, `domain/entryDocument.ts`), so undo and redo count without reading transaction meta, and typing inside an open wording box never does — it's typing, marked like prose. `is_paste` comes from ProseMirror's `uiEvent` meta, so a drop or the image-attach path doesn't count; `media_changed` from `!sameMedia`, so attaching and removing both count. A paste into a wording box goes through its own `<input>` and sets neither.

One recorder captures every stream: in anchor mode the parent's provisional document and the related entry's prose are two `TraceRecorder` instances. Anchor mode limits what the _editor_ can produce (ENTRY_MODEL.md, "Two creation experiences, kept separate"), not how it's recorded.

A trace belongs on any typed entry, not only revisions, so a first draft is captured the same way.

## Marks

**Durability and marks are separate jobs.** Every event is persisted, constantly, to never lose work; marks identify the moments worth stopping at when reviewing how something was written.

**Marks are derived from the log, never stored with it.** `deriveMarks(events, policy)` (`domain/marks.ts`) reads them in one pass, so a recorded session can be read under any policy, including one written after it. A mark is `{ at, index, reasons }`, where `index` counts the events before it: the marked document is `events.slice(0, index)` applied to `base_content`. Reasons are `pause | paste | media | deletion | punctuation | pattern | interval | format | anchor | manual`, all tunable (`punctuation` is a configurable character set, `pattern` a user-supplied match, empty by default). A mark can carry several, ordered by priority so `reasons[0]` is the one to show. Marks closer than `minMarkGapMs` merge into one at the end of the cluster, so bolding eight words one at a time is one stop; a `manual` mark never merges.

`deletion` is judged in retrospect: a run of deletions is marked when it ends — at the next edit that removes nothing, the next deletion after a pause, a manual mark, or the end of the log — at the run's last deleting edit, so one mark covers everything removed in one go.

## Mark sets

A mark set is one entry's session read under one policy: the policy, a name that is only a label, the trace's `base_content`, and one **frame** per mark. It is what the history view plays.

```ts
interface MarkFrame extends AuthoringMark {
  net: { steps: unknown[] } | { document: EntryDocument }
  changes: FrameChange[] // { kind: 'added' | 'removed' | 'formatted' | 'anchor', from, to, removed? }
}
```

**A frame stores only its net change** since the previous mark: one replace step over the range where the two documents differ (`findDiffStart`/`findDiffEnd`). Viewing applies each frame's step in turn from `base_content` (`documentsFromFrames`), so storage is about the final document plus what was deleted along the way. Each step is checked at build time; one that doesn't reproduce the document is stored as the document itself, so every frame is right by construction.

**`changes` come from the steps, not a text diff**, which would miss formatting and anchors and guess where a repeated word went. Text and node changes come from `ChangeSet` (`@tiptap/pm/changeset`), which also cancels anything typed and deleted again before the mark. Mark, attribute and rewrapping steps don't register there, so their ranges come from the steps, mapped forward and clipped to where the documents differ. Positions are ProseMirror positions in that frame's own document and never leave it — deliberately not the `docToPlainText` ruler anchors, search and diff use. Comparing two versions, where no steps may exist, stays `diffDocuments`' job.

**Sets are a cache, so they may be deleted.** A set regenerates from the immutable trace and its stored policy. Retuning makes a new set beside the old one. A default set is built lazily, the first time an entry's sets are loaded (`markSetsStore.loadMarkSets`), never at seal time, so a writer who never opens an entry's history pays nothing. A draft has no set: its log is still growing, so it reads `deriveMarks` directly.

## Three stores

Entries are permanent and append-only and receive only finished entries. A session in progress can't write there without rewriting one row per keystroke or creating thousands, so it accumulates in a separate **draft** store keyed by session. Mark sets are the third store, kept apart because they're derived and deletable, which no entry is.

## Drafts

The draft store is persisted through the same local-first layer as entries, flushing a few hundred milliseconds after the first unsaved change, and so at that interval through continuous typing: a crash costs well under a second of it. This is autosave and unrelated to marks. Its event logs are append-only while the session runs; the only thing that disappears is the whole row, removed when it is sealed or discarded. That makes the draft store the write rule's sanctioned exception: working space, not history.

**Sealing is an explicit user action**, never an idle timeout. Until then the work is durable, recoverable, and absent from timelines, so drafts get their own list; none is stranded invisibly.

```ts
interface DraftDocument {
  base_version_id: string | null // the version it started from; null for a new entry
  base_content: string // the document as this session found it; never rewritten
  content: string
  events: AuthoringEvent[]
}

type DraftFields = Omit<VersionedFields, 'content' | 'media_refs'>

type Draft = {
  session_id: string
  started_at: string // shared by both documents' traces — one session, two documents
  updated_at: string
  entry: DraftDocument & DraftFields // the entry this session produces
} & (
  | { kind: 'new_root' }
  | { kind: 'new_related'; parent_id: string; parent: DraftDocument } // anchor mode
  | { kind: 'new_connection'; parent_id: string; target_id: string }
  | { kind: 'revision'; parent_id: string } // text mode
)
```

`new_root`, `new_connection` and `revision` seal into one entry, the `entry` document becoming its trace. `new_related` seals into the related entry, plus a parent revision if anything was anchored, the `parent` document becoming that revision's trace. `kind` lets the drafts list say what each draft is attached to. A `DraftSnapshot` is a draft without its event logs: what the list reads and a draft row stores.

**The draft carries every versioned field**, and its values are what gets sealed: unset for a new entry, copied from the current version for a revision, so whatever the writer leaves alone saves unchanged. `media_refs` is derived when sealing, and the parent's title isn't stored, since anchor mode never changes it.

**Each document records the version it started from**, which sealing copies into the revision it writes, refused if stale (ENTRY_MODEL.md, "Version chains"); `base_content` beside it is what rebasing a stale draft would need. The parent's pair also says which anchors this session may still change, never stored as a list: `anchorsPlacedSince(base, current)` (`domain/anchors.ts`) reads the difference on demand, so an anchor placed then undone leaves nothing to subtract, and it survives a reload, where `parent.content` alone can't tell this session's anchors from sealed ones.

**A draft that could revise an entry is a claim** — a `revision`, or a `new_related` whose anchors revise the parent (`versionsRevisedBy`, `types/draft.ts`) — and the entry offers to resume it rather than start another. It is written when the session begins, so another tab sees it before anything is typed, and kept while the session is open however empty. Abandoning it removes it only if the stored draft holds no work (`draftHoldsWork`), judged on disk because another tab may have written since. A tab closed mid-session can't be relied on to finish a delete, so that draft stays; staleness is left to the refused save.

**Sealing is one transaction.** `DraftRepository.seal` removes the draft and writes its entries together, so a crash can't leave a draft whose entries already exist, to be saved twice. The removal goes first, so a refused revision rolls it back too.

**One draft, many tabs.** Disk is authoritative: resuming reads the stored draft, and a released session is dropped from memory once flushed. A tab being left flushes at once; a tab being returned to (visibility or focus, wired in `App.vue`) reloads each open draft whose stored `updated_at` isn't the one it last read or wrote, and closes one sealed or discarded elsewhere, saying so. Event rows are added, never put, so two tabs writing at once can't interleave one log: an append at an index already stored is a `DraftConflictError`, the whole save rolls back, and the losing tab keeps the other's version and shows its own text to copy. The gap — a title- or dates-only write from a tab not yet checked — needs focus, which checks first.

## Considered and rejected

- **Deciding marks while the writer types**, storing the resulting bookmarks. That froze the policy at capture time, needed state seeded across reloads and backdated deletion marks, and lost `paste` for any later policy. Storing signals and deriving marks removed all three.
