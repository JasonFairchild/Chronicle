# Chronicle — Product Behavior

What Chronicle does, described from the outside. No code, no data model, no file names — if a
sentence here can't be checked by using the app, it belongs in another document.

**How to use this doc**

- It is the plain-language answer to "what should happen when I do this?" — the thing a test is
  written against, and the thing to re-read when a feature starts drifting.
- Every behavior carries a status: **Built** (works today), **Next** (agreed, not built),
  **Idea** (worth keeping, not decided).
- Future Considerations is a parking lot, not a plan. Ideas go there the moment they occur so they
  stop taking up room in anyone's head. Nothing there is a commitment.
- The technical companions: [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md) for the phased plan,
  [ENTRY_MODEL.md](./ENTRY_MODEL.md) for how records are actually shaped, and
  [TESTING.md](./TESTING.md) for how tests are written.

---

## 1. What Chronicle is

A private notebook for a life: things that happened, things you thought about them, and the way
those things connect. It runs entirely on your own device, works with no internet connection, needs
no account, and never sends your writing anywhere.

Its distinguishing idea is that **nothing you write is ever overwritten**. Correcting an entry adds
a new version rather than replacing the old one; commenting on a passage leaves the passage intact.
The record of what you thought last year survives changing your mind about it this year.

## 2. Promises the product makes

These are the claims the app should always be able to keep. A change that breaks one of them is a
bug even if nothing else complains.

1. **It works offline.** Everything is on the device. Nothing waits on a network.
2. **Nothing you typed is lost.** Writing is saved continuously while you write, and survives a
   crash, a closed laptop, or a reload.
3. **Nothing is destroyed by a later action.** Edits, notes, and corrections add; they never erase.
4. **You can always see how something got to be the way it is.** Every entry can, in principle,
   account for its own history.
5. **Nothing enters your history unless you put it there.** Saving is always a deliberate act.
6. **It should be readable in the dark.** No part of the design may make a dark theme impossible.

## 3. Vocabulary

The words the interface should use, and what a user should take them to mean.

| Word           | Means                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Entry**      | One record. Everything in Chronicle is one — a journal entry, a note on one, a link between two. |
| **Timeline**   | The list of entries, newest first.                                                               |
| **Annotation** | A note about an entry, or about one passage in it. Claims nothing changed.                       |
| **Update**     | A note that strikes wording or proposes different wording. Same shape as an annotation.          |
| **Connection** | A link from one entry to another, with your explanation of why they relate. Directional.         |
| **Revision**   | A new version of an entry's own text. The previous version stays.                                |
| **Draft**      | Writing in progress. Saved as you type, invisible to the timeline until you save it.             |
| **Passage**    | Text you selected inside an entry, which a note can be attached to.                              |

Two words are deliberately absent from the interface: "delete", in the sense of erasing history, and
"edit", in the sense of replacing what was there. Annotation and update are never asked about
either — they are names for what a note turned out to be, not a choice to make before writing one.

---

## 4. Behavior today

### 4.1 Writing a new entry — Built

- The timeline page has a writing area at the top, always ready. No "new entry" step first.
- An entry is titled in a field of its own, above the toolbar: one line, plain text, no formatting.
  Enter or Tab moves from it into the body.
- **A title is optional.** Naming an entry is worth doing when there is a name worth giving, and a
  great deal of journal writing has none — a required field there produces "Tuesday" and "thoughts"
  rather than better names. Where only one line of an entry can be shown, it is named by its title
  if it has one and by its opening words otherwise.
- Related entries (§4.4) get the same optional title field. A related entry can be substantial
  enough to name in its own right — a later chapter of what the parent started, a major update, or
  something closer to a connection entry that happens to pertain to one parent — and they are
  anticipated as first-class in some timeline views (§6).
- Above the writing area are two optional dates: when the thing **happened**, and when it was
  **originally written** somewhere else. Each takes a day, and beside it a free line of text for the
  time — "morning", "3:30 pm", "after dinner" — because that is how a paper journal says it and
  neither half is worth forcing into the other's shape. Both are offered on a related entry too.
  Leaving them empty is normal; an entry written today about today needs neither.
- A toolbar offers undo and redo, two levels of heading, bold, italic, underline, strikethrough,
  bulleted and numbered lists, quotes, links, clearing formatting, and adding an image. Everything
  it offers also works from the keyboard, including markdown shortcuts such as `## ` and `- `.
- Strikethrough here is an ordinary formatting mark, no different from bold or italic — applying it
  to your own text while writing or revising does not create a note or touch any other entry. A
  strike delivered by a child entry (§4.4) is a different gesture, an attached explanation rather
  than a mark you typed, and stays legible as that through its own presentation rather than through
  strikethrough being scarce (see "Making anchor ops unmistakable" in Future Considerations).
- **Everything typed is saved as a draft continuously**, within a fraction of a second. Closing the
  tab mid-sentence costs nothing.
- Nothing appears on the timeline until **Save entry** is pressed. There is no autosave-into-history
  and no idle timeout that decides for you.
- After saving, the writing area is empty and ready for a genuinely new entry — not holding remnants
  of the last one.
- An empty entry cannot be saved.

### 4.2 The timeline — Built

- Shows top-level entries, newest first, each as a card with its date, a preview of its text, and
  its title when it has one — an untitled entry shows no stand-in label, since the preview beneath
  already opens with its own words. A card also says when the thing happened, or when it was
  originally written, if the entry says so — the card's own date stays what it always was: when the
  entry entered Chronicle.
- A card says how many times its entry has been revised, when it has been.
- Clicking a card opens that entry.
- Notes, updates, connections, and revisions do **not** appear as separate cards on the main
  timeline. They belong to the entry they are attached to.

### 4.3 Reading an entry — Built

- Shows the entry's title, when it happened and when it was originally written if it says so, when
  it was created, and its current text — meaning the latest version, with earlier versions still on
  record. An entry with no title is headed by the date it was created: the text is already on the
  page, so repeating its opening line above it would say the same thing twice.
- If it has been revised, it says which version you are looking at and how many exist.
- Attached images appear below the text.
- Notes, updates, and connections attached to it are listed beneath, each showing what part of the
  entry it points at.
- A note pointing at a passage that no longer exists still shows what it _was_ attached to, quoting
  the original wording. A broken reference reads as history, not as an error.
- Immediate children are shown; deeper ones are indicated rather than expanded.

### 4.4 Writing a related entry — Built

- An entry offers two things to do to it: **Create related entry** and **Revise entry**. There is
  one way to say something about an entry, not a form for the quick case and buttons for the
  anchored one.
- Creating a related entry opens a session with two columns side by side: the entry being written
  about on the left, and the new entry on the right. Anchoring is its own mode, never mixed with
  revising the entry's own text in the same sitting (ENTRY_MODEL.md, "Two creation experiences,
  kept separate").
- On the left, the entry's text is shown live: select a passage and a small menu appears above it
  offering **Highlight** or **Strike** (also reachable as Ctrl+Alt+H / Ctrl+Alt+S); or place the
  cursor and type to propose wording inline, right where it would go. Nothing outside those two
  gestures can change the entry's own text from here.
- On the right, the note itself, with the same optional dates a new entry gets (§4.1).
- Marking a passage is optional. Writing on the right and marking nothing produces a note about the
  entry as a whole, and the entry is not revised at all.
- Wording may attach to a highlighted passage as readily as a struck one — one mechanism for typing
  it either way, rather than a strike-only field. It renders inline, right after the highlight or
  strike it belongs to — declared as belonging to that passage rather than guessed from where it
  landed, and read as proposed wording from its own italic styling rather than from any glyph. A
  proofreader's-markup presentation, with the wording raised above the line and a caret glyph on the
  baseline marking the insertion point, exists in code but is dormant (`DocumentEditor.vue`,
  `ANCHOR_MARKUP_MODE`) — a first attempt at it let long wording overlap trailing text on a packed
  line; see "Making anchor ops unmistakable" below.
- Saving anchors a passage and the note together in one action; the entry's own text is not touched
  except to gain the anchor, and its previous version stays exactly as it stood.
- Whether the note reads as an **annotation** or an **update** follows from what was marked, and is
  never asked. Commenting on a passage claims nothing changed, so it is an annotation; striking
  wording or proposing different wording reports a correction, so it is an update. A note that
  marked nothing is an annotation, the quieter of the two claims.
- Notes can themselves be annotated, so a conversation with yourself can go deeper than one level.
- An anchor is fixed once its note is saved. Pointing differently at the same passage later means
  writing another note, not editing the first one's anchor (see §6, "Editing a child entry's
  anchors").
- An anchor already placed earlier in the _same_, still-open session can be clicked to reopen it —
  either its highlighted or struck passage, or its wording, both take you to the same box. From
  there: edit the wording, switch the passage between highlight and strike (Ctrl+Alt+H / Ctrl+Alt+S
  work here too), or remove it outright. Escape restores whatever the box held when it opened rather
  than discarding it.
- Anchors are exclusive: a passage already covered by one — this session's own, or an earlier
  child's already-sealed one — can't be covered by a second. Selecting or clicking into an existing
  anchor's passage at all, whether that's the whole thing, part of it, or a range that only partly
  overlaps it, opens that anchor's box instead of creating a new one, provided it's this session's
  own; touching a sealed anchor from an earlier child does nothing, since only the child that placed
  one may still change it (see §6, "Editing a child entry's anchors"). A selection touching no
  anchor at all marks a fresh one, same as always. Widening or shrinking an anchor's span isn't
  offered; remove and recreate covers that.
- Highlight color is a display setting, not something stored with the note — today that means one
  system scheme by note kind; switching schemes later never touches history.

### 4.5 Revising an entry — Built

- **Revise entry** opens the entry's current text for editing.
- Editing produces a pending draft. The entry itself is untouched until the revision is saved, and
  the change can be discarded with no trace left on the entry.
- Saving appends a new version. The previous version stays on record and the entry's version count
  goes up.
- Revising an entry that already has images keeps them.
- Renaming is an ordinary revision — you retype the title and save. The entry's old names stay on
  record with the versions they belonged to, since the title rides the version chain alongside the
  text.
- The title field is offered every time an entry is written or revised, the same as when it was
  first created — naming it, renaming it, or clearing it out are all just an ordinary revision.
- Existing anchors show natively while you edit, since they live in the entry's own document. If the
  edit would change the text underneath one — inserting into it, or deleting part or all of it — a
  warning names the note before you save. Moving an anchor by editing elsewhere is not a change and
  stays silent. The note survives either way (§4.4), but the user deserves the chance to reconsider.

### 4.6 Connections — Built

- **Add connection** opens a full screen for creating one — the same tools as writing any entry
  (a title, the optional dates, rich text with the whole formatting toolbar), plus a choice of which
  other entry it points to. A connection is not a lightweight second-class thing with its own
  cut-down form; it is an entry that happens to also name a destination.
- There is no separate short label for how two entries relate. What the connection is called, on
  both ends it joins, is its own title — the same rule that names every other entry.
- A connection needs no title either. It can be as light as recognising that two entries share
  something, and asking that recognition to be named before it can be recorded would stop most of
  them from being made. An untitled one is named by its opening words wherever it is listed.
- The connection is visible from both ends, marked as outgoing or incoming.
- A connection is itself an entry: it can be annotated and revised like anything else. Its notes
  belong to the connection, not to either entry it links.

### 4.7 Images — Built

- Images can be added into an entry while writing, and appear inline in the text.
- They are stored on the device with everything else and display offline.
- A failed attachment says so rather than failing silently.

### 4.8 Drafts — Built

- A **Drafts** page lists every unfinished writing session, so nothing is stranded invisibly.
- Each draft says what it would become — a new entry, a related entry on a named entry, or a
  revision of a named entry — with when it was last touched and a preview. It does not say
  annotation or update, because an unsealed draft has not settled that yet (§4.4).
- A draft can be resumed (continuing where it left off, not restarting), saved as an entry, or
  discarded.
- Drafts never appear on the timeline.

### 4.9 How writing is remembered — Built, invisible for now

While you write, Chronicle quietly records how the text came to be — not only the finished result.
Each change carries signals like whether you paused, pasted, attached an image, or finished a
sentence. Which of those add up to a bookmark worth returning to is decided later, not while you
write, so bookmarking can be introduced or retuned at any point and reach back over everything
already written.

Today this is invisible: it is captured and stored but nothing displays it. It is what makes the
scrubbable history view (§5.1) possible, and it is why that feature can be built later without
retroactively wishing we had kept something.

---

## 5. Agreed but not built

### 5.1 Scrubbing an entry's history — Next

A view of a single entry that can be dragged backwards through time, showing the entry as it stood
at each moment. Not only version to version: within a single writing session, the bookmarked moments
are stops on the same track. It should feel like the global timeline, not like a separate tool.

### 5.2 Showing what a revision changed — Next

When looking at a revision, show what actually changed since the version before it — additions and
removals marked in the familiar way, rather than two blocks of text to compare by eye.

### 5.3 Known gaps in what exists

- **A date, once given, cannot be corrected — from the screen.** Dates are supplied when an entry is
  written (§4.1) and no screen offers to change one afterwards, so a typed-in wrong year stays
  wrong. What's missing is only the UI: a version now carries the dates it was saved with, so
  correcting one is an ordinary revision and the old date stays on record with the new one beside
  it, exactly the way changed wording does. The same holds for where an entry happened and what it
  was first written in, which nothing offers to fill in yet either. `created_at` is the exception
  and stays untouchable, being the ledger's own stamp rather than anything a person said.
- **Nothing sorts by when things happened.** The timeline is ordered by when entries were added.
  The dates a person supplies are shown but do not yet change any ordering, and the free-text time
  beside each one is deliberately not interpreted.
- **No way to find anything.** No search, no filtering, no browsing other than scrolling.
- **Theme.** Dark mode is unblocked but neither finished nor switchable.
- **Connections are invisible as a whole.** They exist one entry at a time; there is no view of the
  web they form.

---

## 6. Future considerations

Not commitments. A parking lot, so ideas stop being remembered by hand.

### Finding things

- Full-text search across entries, notes, and connections.
- Filtering the timeline: by kind, by date range, by tag, by whether an entry has been revised.
- Choosing what the timeline is ordered by — when things were entered, or when they happened.
- Choosing what the timeline _contains_: showing revisions as their own cards is a legitimate view
  (how often was this reworked?), as is hiding them entirely.
- Tags, as a real filterable thing rather than a note to yourself inside the text.
- Pinning or color-coding the entries that matter.

### Seeing the shape of things

- A connection that points at several entries, not just one. A connection is already an entry that
  happens to name a destination; letting it name more than one would make "these three all circle
  the same thing" a single record rather than three pairwise connections saying it separately. It
  would still have its one parent, still appear in timeline views like any other entry, and also
  show up in the web-like views below. Needs a shape for the extra targets — `target_id` holds one
  today — and a decision about whether the graph draws it as a node with several edges or as a
  hyperedge.
- A graph view of connections — entries as nodes, connections as labeled arrows. With the above,
  some connections are nodes in their own right rather than only the arrows between them.
- An optional nudge toward titling something when leaving it unnamed would cost the writer
  legibility later — a connection joining several entries, say, or anything a web view has to label.
  A nudge, not a requirement (§4.1).
- A way to open a connection's own entry page. Today the Connections list on each endpoint links to
  the _other_ entry, not to the connection itself, so a connection's own revisions and annotations
  have no route in from the UI — even though the data model already treats a connection as an entry
  like any other and supports it.
- Related entries as first-class citizens in some timeline views. Now that a related entry can carry
  its own title (§4.1), one substantial enough to be a later chapter or a major update reads less
  like a footnote and more like something a timeline could surface on its own, not only nested under
  the entry it pertains to.
- Navigating by connection rather than by time.
- One entry's whole subtree as an activity stream: everything that ever happened to it, in order.
- Expanding past the default two levels of depth on demand.
- Diff like presentation between 2 revisions or perhaps multiple selected revisions on both sides? Can anchor ops be included in such a view?
- Comprehensive rendering of authorship sessions with detailed time info surfaced. Perhaps a scrubbable widget that will demonstate the evolution of an authorship session from start to finish. (I have a thought about scrubbing through the saved bookmarks and the affects of those marks appearing/disappearing in a document view of the revision depending on user input/position in the timeline)

### Making anchor ops unmistakable

Now that ordinary formatting (strikethrough included) can look similar to what an anchor op
renders, an anchor op earns its distinctness from its own presentation rather than from any mark
being reserved for it alone. Today that distinctness rests on italic-plus-color styling for the
wording itself (§4.4) — the dormant raised-wording presentation would be a stronger step in that
direction, proofreader's markup reading as nothing else in the editor does, once it's back — but
neither resolves the whole problem on its own:

- Ordinary highlight formatting as a mark (a note-less highlight, the way strikethrough became
  ordinary formatting) would collide with the comment anchor's system yellow the moment both exist,
  since nothing today distinguishes "highlighted" from "commented on" by color alone. Anchor ops
  need to earn distinctness through their own presentation one step further than they do today.
- Arbitrary text coloring for the parent entry, if it's ever added (no such feature is planned or
  requested today), would weaken the inline wording's italic-plus-color signal further: "this is
  proposed wording, not the original" reads less clearly the more the original text is itself
  colored. Worth rechecking whichever presentation is active against that at the time.
- Color schemes for anchor highlights — system (by op kind), per-child auto-assigned, or
  user-defined palettes — chosen as a display setting rather than stored with the entry, so
  switching schemes never touches history. Inline vs. interlinear wording placement is a second
  thing that same setting would choose: both presentations exist in code today (§4.4), just not a
  setting to pick between them yet — interlinear is dormant until one exists.
- A tag-linked scheme as a fourth option: color the tag, not the child, once tags are a real thing
  (see "Finding things" above) — a user colors a tag, applies it to entries at will, and an anchor
  on a tagged entry can adopt that color on command instead of the system or per-child default.
- Numbering anchor ops visually so a passage and its explanation are obviously paired.
- A hover state on an anchor that surfaces which child entry it belongs to.
- A preview of a child entry's commentary sitting near the passage it anchors to, not only listed
  below the parent's text.
- Overall presentation of the 'current' state of a parent entry with multiple child entries shown with their anchors and formatting.

### Extending what can be anchored

The anchor menu (§4.4) is built contextual so both of these have somewhere to land, but neither is
built:

- Anchoring a connection to a passage rather than to a whole entry — today a connection always
  points at its target entry as a whole.
- Anchoring to an image, a media node, or a caption. `MediaImage` is a block atom, so the `anchor`
  mark cannot apply to it at all as things stand; this needs node-level anchor attributes instead of
  a mark.

### Getting things in

- Importing a batch of scanned journal pages or photos as an unfiled queue, then turning them into
  entries one at a time, deliberately, with your own context added. Never bulk-creating entries
  nobody has read.
- Reading text out of a scanned page automatically to pre-fill a draft — still ending in human
  review before it becomes an entry.
- Importing from other journaling apps or from plain text files.
- Supplying when something happened at import time, so old material sorts by its own date rather
  than by the day it was imported.

### Getting things out

- Export and backup — the whole archive, in a form that outlives this app.
- Printing or exporting a single entry with its notes and history attached.
- Restoring from a backup on a new device.

### The writing experience

- Voice to text dictating
- Editing a child entry's anchors after it's sealed. Decided against for now (§4.4, ENTRY_MODEL.md):
  anchors are fixed once sealed, and pointing differently at the same passage means adding another
  child entry today. Re-opening a sealed child's anchors is architecturally possible — they'd be
  ordinary document steps on the parent, captured the same way any other revision is — just not
  offered as a feature yet. This is also the intended answer to anchor exclusivity's one real
  limit: since a passage can only carry one anchor at a time (§4.4), a second opinion on an
  already-anchored passage waits on this being built, not on reintroducing overlap.
- Widening or shrinking the span of an anchor already placed earlier in the _same_, still-open
  draft session — before sealing, unlike the point above, where reopening it to edit wording,
  switch kind, or remove it outright is built (§4.4). Remove-and-recreate covers a resize today;
  a real resize gesture is not decided against, just not built.
- A distraction-free writing mode.
- Templates or prompts for recurring kinds of entry.
- Keyboard-first navigation throughout.
- Tuning how often writing moments get bookmarked, or turning that capture off — including the open
  question of whether it should be a user-facing switch at all.
- Re-scoring an already-recorded writing session under a different, or later, set of bookmark
  rules — viewing an old session's bookmarks as they'd fall today, without re-capturing anything.
  Capture already supports this, pasting included; what's missing is a way to choose the rules.
- Richer text: links, quotes, lists, checklists.
- Smart links: Ones that have a preview for at least common sources (maybe google docs or one drive?) But personally, links to LDS scripture are perhaps the most important. I imagine this would primarily be a hover mode that would shows the full text of the scripture reference. (probably requires internet or we decide to cache things in app. Configurable?)

### The app itself

- Finished light and dark themes with a switch that remembers the choice.
- A polished install experience, so it lives on a phone home screen or a desktop like a real app.
- Onboarding for a brand-new, empty archive — what to write first.
- An honest account, somewhere in the interface, that nothing is ever deleted, so the promise is
  discoverable rather than merely true.

### Bigger, later, maybe

- Audio and video entries.
- Ambient context attached to an entry — where you were, what the weather was — captured
  automatically rather than typed. (perhaps from third parties as I doubt I'll want to save weather data automatically)
- Encryption of the local archive.
- Syncing across devices, which changes several of the promises above and needs its own thinking.
- A desktop application shell.

---

## 7. Deliberately not doing

Recorded here so they do not get re-proposed.

- **No account, no server, no cloud.** Not a default to be changed later — the design.
- **No social features.** Chronicle is for one person.
- **No deleting history.** Discarding an unsaved draft is the only thing that disappears, and it was
  never history.
- **No automatic entries.** Nothing is written into the timeline that a person did not decide to put
  there.
- **No AI writing the entries.** Whatever assistance eventually exists, the writing is the user's.
