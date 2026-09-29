# Chronicle — Architecture

The whole app on one page: what each layer holds and how data moves between them. The docs in
CLAUDE.md's table own the details; this owns only the picture. Update it in the same change that
adds, removes or reroutes a store, table, repository or flow.

It uses Mermaid's ELK layout, which VS Code's built-in preview supports; a renderer without ELK
falls back to the default layout, which draws it less tidily.

**Reading it.** Arrows are data moving, labelled with what moves; two heads means both ways. Thick
is the path every saved entry takes, from keystroke to screen. Dotted is one row naming another by
id, or a link to something planned, which has a dashed box.

- **Write** — a session lives in `draftsStore` as a snapshot plus one `TraceRecorder` per
  document, flushed to two tables as it goes. Sealing turns it into entries in one transaction
  that also deletes the draft. [AUTHORING.md](./AUTHORING.md), "Drafts".
- **Stored** — `entries` is never rewritten; `drafts` and `draftEvents` are working space, and
  `markSets` a deletable cache. Media blobs sit in OPFS. Each repository has an in-memory twin for
  tests, held to the same `.contract.ts`. The panel dotted to `entries` is one entry's rows:
  [ENTRY_MODEL.md](./ENTRY_MODEL.md).
- **Read** — nothing is stored in its viewed form. An entry is folded from its rows on every read,
  and mark sets are built from its trace the first time its history is opened.

```mermaid
---
config:
  layout: elk
  flowchart:
    useMaxWidth: false
  themeCSS: ".edge-pattern-dotted { stroke-dasharray: 2 7 !important; } .edge-thickness-thick { stroke-width: 3.5px !important; }"
---
flowchart TB
  subgraph WRITE["WRITE · a session, until it's sealed"]
    direction LR
    DE["<b>DocumentEditor.vue</b><br/>TipTap · extensions.ts · anchorCommands.ts<br/>anchor-mode guard · affected-anchor tracking"]
    SES["<b>useDraftSession</b><br/>one per composer on a screen below:<br/>begin · resume · save · discard<br/>stale / elsewhere notices"]
    TAB["<b>App.vue · useTabReturn</b>"]
    DS["<b>draftsStore</b><br/>ActiveSession = DraftSnapshot<br/>+ TraceRecorder · entry<br/>+ TraceRecorder · parent"]
    INPUTS["<b>entriesStore.inputsForDraft</b><br/>draft kind → CreateEntryInput[]<br/>anchorsPlacedSince · relationTypeForAnchors"]
  end

  subgraph STORE["STORED · repositories/index.ts"]
    direction LR
    SEALTX{{"<b>DraftRepository.seal</b> · one transaction<br/>assertValidRelation → insert entries → delete draft<br/>stale base → StaleVersionError"}}
    T_DRAFTS[("<b>drafts</b><br/>DraftSnapshot · overwritten")]
    T_EVENTS[("<b>draftEvents</b><br/>AuthoringEvent rows · appended")]
    T_ENTRIES[("<b>entries</b><br/>Entry · append-only")]
    OPFS[("<b>OPFS</b><br/>media blobs by id")]
    T_MARKSETS[("<b>markSets</b><br/>MarkSet · deletable cache")]
  end

  subgraph MODEL["inside entries: one entry's rows"]
    direction TB
    E["<b>E</b> · root<br/>version 1 · content + authoring_trace"]
    R1["<b>R1</b> · revision · direct<br/>every VersionedField + trace"]
    R2["<b>R2</b> · revision · anchor<br/>current doc + anchor marks"]
    A["<b>A</b> · annotation / update<br/>anchors: anchor_id + quote<br/>sealed with R2 in one write"]
    C["<b>C</b> · connection"]
    F["<b>F</b> · another root"]
  end

  subgraph READ["READ · folded when viewed"]
    direction LR
    RECON["<b>reconstructEntryState</b><br/>fold version chain · asOf<br/>resolveAnchors · gather connections"]
    AGG["<b>AggregatedEntry</b><br/>current version i of n<br/>related_entries · connections"]
    HIST["<b>buildEntryHistory</b><br/>EntryVersion[] · no UI yet"]
    DM["<b>deriveMarks</b>(events, policy)<br/>AuthoringMark[]"]
    BF["<b>buildFrames</b>(trace, marks)<br/>replay.ts · ChangeSet"]
    MSS["<b>markSetsStore</b><br/>Default set built on first open"]
    SCRUB["<b>Scrubbable history view</b><br/>documentsFromFrames · planned"]

    subgraph SCREENS["screens · each composer mounts DocumentEditor"]
    direction LR
      TL["<b>TimelineView</b><br/>EntryList · EntryCard · EntryForm"]
      DV["<b>EntryDetailView</b><br/>revise · RelatedEntryComposer"]
      NCV["<b>NewConnectionView</b>"]
      DV2["<b>DraftsView</b><br/>resume any draft"]
    end
  end

  %% write path
  DE ==>|"@change: EditorChange<br/>content · title · steps · signals"| SES
  SES ==>|"recordChange · recordParentChange<br/>recordDates"| DS
  TAB -->|"tab hidden: flushAll<br/>tab back: adoptChangesElsewhere"| DS
  DS <-->|"save, throttled 300ms: upsert<br/>getById: resume · another tab's"| T_DRAFTS
  DS <-->|"save: append new events only<br/>getById: rejoin the log"| T_EVENTS
  DS ==>|"sealDraft: snapshot<br/>+ recorder.seal() = AuthoringTrace"| INPUTS
  INPUTS ==>|"CreateEntryInput[]"| SEALTX
  SEALTX ==>|insert| T_ENTRIES
  SEALTX -->|delete| T_DRAFTS
  SEALTX -->|delete| T_EVENTS
  DE -->|"image: useMedia.put"| OPFS

  %% entry model
  MODEL -.-|"rows, for example"| T_ENTRIES
  R1 -.->|"parent_id<br/>base_version_id"| E
  R2 -.->|parent_id| E
  R2 -.->|base_version_id| R1
  A -.->|parent_id| E
  A -.->|"anchor_id → mark in R2's doc"| R2
  C -.->|parent_id| E
  C -.->|target_id| F

  %% read path
  T_ENTRIES ==>|"listDescendants<br/>or roots + revisions"| RECON
  RECON ==> AGG
  AGG ==> TL
  AGG ==> DV
  AGG --> NCV
  T_ENTRIES --> HIST
  T_DRAFTS -->|"list(): DraftSnapshot[]"| DV2
  OPFS -->|"useMedia.applyTo"| DV
  T_ENTRIES -->|"authoring_trace"| DM
  DM --> BF
  BF -->|"MarkFrame[]"| MSS
  T_MARKSETS <-->|"create · listForEntry"| MSS
  MSS -.-> SCRUB

  classDef planned stroke-dasharray: 6 4
  class SCRUB planned
```
