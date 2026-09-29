# Chronicle — Product Behavior

What Chronicle does, mostly as the writer sees it: the answer to "what should happen when I do
this?", the thing a test is written against. Plain language where it's as short; the app's own terms
or a code name where that's the simplest way to say it. How records are shaped is
[ENTRY_MODEL.md](./ENTRY_MODEL.md); how writing is captured is [AUTHORING.md](./AUTHORING.md); the
order work happens in is [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md).

- §4 is **built**. §5 is **decided**, not built. §6 **may or may not** happen: ideas go there the
  moment they occur so they stop taking up room in anyone's head. §7 is decided against.

---

## 1. What Chronicle is

A private notebook for a life: things that happened, things you thought about them, and the way
those things connect. It runs entirely on your own device, works with no internet connection, needs
no account, and never sends your writing anywhere.

Its distinguishing idea is that **nothing you write is ever overwritten**. Correcting an entry adds
a new version rather than replacing the old one; commenting on a passage leaves the passage intact.

## 2. Promises the product makes

A change that breaks one of these is a bug even if nothing else complains.

1. **It works offline.** Everything is on the device. Nothing waits on a network.
2. **Nothing you typed is lost.** Writing is saved continuously and survives a crash, a closed
   laptop, or a reload.
3. **Nothing fundamental is destroyed by a later action.** Edits, related entries, and corrections
   add; they never erase.
4. **You can always see how something got to be the way it is.**
5. **Nothing enters your history unless you put it there.** Saving is always a deliberate act.
6. **It should be readable in the dark.** No part of the design may make a dark theme impossible.

## 3. Vocabulary

| Word              | Means                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **Entry**         | One record. Everything in Chronicle is one — a journal entry, one about it, a link between two.  |
| **Timeline**      | The list of entries, newest first.                                                               |
| **Related entry** | An entry about another, as a whole or about passages in it: an annotation or an update.          |
| **Annotation**    | A related entry about an entry, or about one passage in it. Claims nothing changed.              |
| **Update**        | A related entry that strikes wording or proposes different wording. Same shape as an annotation. |
| **Connection**    | A link from one entry to another, with your explanation of why they relate. Directional.         |
| **Revision**      | A new version of an entry's own text. The previous version stays.                                |
| **Draft**         | Writing in progress. Saved as you type, invisible to the timeline until you save it.             |
| **Passage**       | Text you selected inside an entry, which a related entry can be attached to.                     |

Two words are deliberately absent from the interface: "delete", in the sense of erasing history, and
"edit", in the sense of replacing what was there. Annotation and update are never asked about
either — they name what a related entry turned out to be, not a choice made before writing it.

---

## 4. Behavior today (Built)

### 4.1 Writing a new entry

- The timeline page has a writing area at the top, always ready. No "new entry" step first.
- A title field sits above the toolbar: one line, plain text, no formatting. Enter or Tab moves into
  the body. **A title is optional** — much journal writing has no name worth giving, and a required
  field produces "Tuesday". Where only one line can be shown, an entry is named by its title, else
  its opening words. Related entries (§4.4) get the same optional field.
- Two optional dates sit above the writing area: when the thing **happened**, and when it was
  **originally written** somewhere else. Each is a day plus a free line for the time ("morning",
  "3:30 pm"), the way a paper journal says it. Related entries offer them too.
- The toolbar offers undo/redo, two heading levels, bold, italic, underline, strikethrough, bulleted
  and numbered lists, quotes, links, clear formatting, and adding an image. All of it works from the
  keyboard too, including markdown shortcuts such as `## ` and `- `.
- Strikethrough here is ordinary formatting, like bold. A strike delivered by a related entry (§4.4)
  is a different gesture with its own presentation (§6, "Making anchor ops unmistakable").
- **Everything typed is saved as a draft continuously**, within a fraction of a second.
- Nothing appears on the timeline until **Save entry** is pressed. No autosave into history, no idle
  timeout.
- After saving, the writing area is empty and ready for a new entry.
- An empty entry cannot be saved.

### 4.2 The timeline

- Top-level entries, newest first, each as a card with its creation date, a preview, and its title
  if it has one (no stand-in label otherwise). A card also shows when the thing happened or was
  originally written, if given, and how many times the entry has been revised, if it has been.
- Clicking a card opens that entry.
- Related entries, connections, and revisions are not separate cards; they belong to their entry.

### 4.3 Reading an entry

- Shows the title, the happened and originally-written dates if given, the creation date, and the
  current text (the latest version). An untitled entry is headed by its creation date.
- A revised entry says which version you're looking at and how many exist.
- Attached images appear below the text.
- Related entries and connections attached to it are listed beneath, each showing what part of the
  entry it points at. Immediate ones are shown; deeper ones are indicated, not expanded.
- A related entry whose passage no longer exists quotes what it _was_ attached to. A broken
  reference reads as history, not as an error.
- A related entry's or connection's own page has a breadcrumb back to what it's attached to.

### 4.4 Writing a related entry

- An entry offers **Create related entry** and **Revise entry**: one way to say something about an
  entry, whether or not it points at a passage.
- Creating a related entry opens two columns: the entry being written about on the left, the new
  entry (with the same optional title and dates as §4.1) on the right. This anchoring mode never
  mixes with revising the entry's own text (ENTRY_MODEL.md, "Two creation experiences, kept
  separate").
- On the left, select a passage and a small menu offers **Highlight** or **Strike** (Ctrl+Alt+H /
  Ctrl+Alt+S); or place the cursor and type to propose wording right where it would go. Nothing
  else can change the entry's text from here.
- Marking is optional. A related entry that marks nothing is about the entry as a whole, and the
  entry is not revised at all.
- Wording attaches to a highlight or a strike alike, renders inline right after its passage, and
  reads as proposed from its italic styling. A proofreader's-markup presentation (wording raised
  above the line, a caret on the baseline) exists but is dormant (`ANCHOR_MARKUP_MODE`): long
  wording overlapped trailing text on a packed line.
- Saving anchors the passages and the related entry together in one action. The entry gains the anchors and
  nothing else; its previous version stays as it stood.
- Annotation or update follows from what was marked, never asked: striking or proposing wording is
  an **update**; highlighting only, or marking nothing, is an **annotation**.
- Related entries can themselves be annotated, to any depth.
- An anchor placed earlier in the same, still-open session can be clicked — its passage or its
  wording — to reopen its box: edit the wording, switch highlight/strike (the same shortcuts), or
  remove it. Escape restores what the box held when it opened.
- **Anchors are exclusive.** Selecting or clicking into an existing anchor's passage, even partly,
  opens that anchor's box if this session placed it, and does nothing if an earlier related entry
  did. Once saved, an anchor is fixed; pointing differently at the same passage means writing another
  related entry. Resizing an anchor isn't offered; remove and recreate it.
- Highlight color is a display setting, never stored with the related entry. Today it's one system
  scheme by anchor kind.

### 4.5 Revising an entry

- **Revise entry** opens the entry's current text and title for editing, as a draft. The entry is
  untouched until the revision is saved, and discarding leaves no trace.
- Saving appends a new version; the old one stays and the version count goes up. Images are kept.
- Renaming, or clearing the title, is an ordinary revision; old names stay with their versions. So
  is a change of formatting alone, such as bolding a passage.
- Existing anchors show while you edit. If the edit changes the text under one — inserting into it,
  or deleting part or all of it — a warning names the related entry before you save, and stays even
  if you change the text back. Moving an anchor by editing elsewhere, or typing right against its
  edge, is not a change. The related entry survives either way.

### 4.6 Connections

- **Add connection** opens a full screen with the same tools as any entry (title, dates, rich text)
  plus a choice of which entry it points to. A connection is an entry that also names a destination.
- It has no separate label for how two entries relate: its title is its name on both ends, and like
  any title it is optional — untitled, it's named by its opening words.
- It is visible from both ends, marked outgoing or incoming, and can be annotated and revised like
  any entry. Its related entries belong to the connection, not to either end.

### 4.7 Images

- Images can be added while writing and appear inline. They are stored on the device and display
  offline. A failed attachment says so.

### 4.8 Drafts

- A **Drafts** page lists every unfinished session, so nothing is stranded invisibly.
- Each draft says what it would become — a new entry, a related entry on a named entry, or a
  revision of a named entry — with when it was last touched and a preview. It never says annotation
  or update, since an unsaved draft hasn't settled that (§4.4).
- A draft can be resumed where it left off, saved, or discarded. Drafts never appear on the
  timeline.
- **One outstanding draft per entry, so versions never branch.** Opening a revision or a related
  entry (whose anchors revise the parent) starts a draft on that entry at once, and until it's saved
  or discarded the entry offers **Resume draft** in place of Revise and Create related entry, in
  every tab. Only one change to an entry can be in progress, the price of a history with nothing to
  merge. Leaving the draft without changing anything removes it; one open when its tab closes
  stays on the Drafts page. If the version a draft started from has been replaced anyway, saving
  refuses and says why, and the draft stays.
- **Two tabs never diverge.** Leaving a tab saves its draft at once. Returning to a tab first loads
  any newer version of its draft, closes one saved or discarded elsewhere and says so, and shows the
  entry's latest version, so nothing is revised from a stale one. If two tabs save at once, the
  first wins and the other shows its own text to copy.

### 4.9 Keeping it on this device

- At startup Chronicle asks the browser to keep its storage through the browser's own clean-ups
  when space runs low. If the browser declines, a quiet, dismissible line says so and suggests
  installing Chronicle, which usually earns it. Nothing in the browser protects against clearing the
  site's data; only a backup outside it can (§5.8).

### 4.10 How writing is remembered — Invisible for now

While you write, Chronicle records how the text came to be, not only the result. Each change
carries signals: a pause, a paste (a drop doesn't count), an image, a finished sentence. Which of
those add up to a bookmark worth returning to is decided later, not while you write, so bookmarking
can be retuned at any point and reach back over everything already written. Nothing displays it
yet; it is what the history view (§5.1) plays.

---

## 5. Decided, not built

### 5.1 Scrubbing an entry's history — Next

A view of one entry that can be dragged back through time, showing the entry as it stood at each
moment — across versions and, within a writing session, at each bookmark. It plays as a chain, one
frame per bookmark: the document grows or recedes mark by mark, each frame's change highlighted,
deletions struck through. It should feel like the global timeline, not a separate tool. What it
plays can already be computed; the view is what's missing. If a session's history can't be replayed
all the way to what was saved, the view says where it ends rather than stopping silently.

### 5.2 Showing what a revision changed — Next

When looking at a revision, show what changed since the version before it — additions and removals
marked the familiar way. A renamed title shows as its own plain-text change. A change of formatting
alone shows too, as formatting rather than as words, so a bold-only revision never reads as having
changed nothing. Open: comparing any two versions, or several; and whether anchor ops belong in such
a view.

### 5.3 Known gaps

- **Dates can't be corrected from the screen**, and nothing offers to fill in where an entry
  happened or what it was first written in. The model already supports both as ordinary revisions.
  The creation date stays untouchable.

### 5.4 Revising a related entry, and locking anchored text

Builds on anchor wording becoming ordinary text (CHRONICLE_PLAN.md, "Anchor wording as marked
text").

- **Revise** on a related entry reopens the two-pane experience of §4.4 rather than plain editing:
  the parent's latest version on the left, the related entry's latest version on the right.
- On the left, the related entry's own anchors behave like ones placed in the current session:
  reopen, switch highlight/strike, edit or remove wording, or remove the anchor. They can also be
  reshaped while keeping their identity and their wording: unmark part of one to shrink it, or
  extend it over adjacent text. New anchors can be added. Every other related entry's anchors show
  but can't be touched, and nothing else on the left can change, as in any related entry.
- Saving revises whichever side changed, together: the related entry, the parent's anchors, or
  both. It stays about its parent for good; it can't be revised into a freestanding entry.
- Annotation or update follows its current anchors, so a revision that removes its last strike and
  wording makes it an annotation.
- **Anchored text is locked everywhere else.** Revising the parent itself shows every anchor but
  can't change the text under one, its wording, or its kind; typing against an anchor's edge is
  still fine. An anchor is removed only by deliberately revising the related entry that placed it,
  so it never goes missing by accident. That replaces §4.5's warning on an affected anchor, and with
  it the quote a related entry saves to render "was attached to: …" once its anchor is gone.
- Anchors stay exclusive (§4.4): a passage belongs to at most one related entry, so a lock never has
  two owners. Saying something different about an anchored passage means revising the related entry
  that holds it.
- Revising a related entry is a draft like any other (§4.8), listed as a revision of it, and is
  outstanding against both it and its parent.
- Reading a parent with several related entries offers its anchors grouped by related entry.
- Open: whether formatting (bold, a list) may still change over anchored text, since it leaves the
  words alone; the lean is to lock it too.

### 5.5 Finding things

- Full-text search across entries, related entries, and connections.
- Filtering by kind, date range, tag, and whether an entry has been revised.
- **Tags**, as a real filterable thing rather than a note inside the text.

### 5.6 Timeline views

- Ordering by when entries were added or by when things happened.
- Choosing what the timeline contains: titled related entries as cards of their own, and revisions
  as their own cards (how often was this reworked?) or hidden.

### 5.7 Connections as a web

- A graph view: entries as nodes, connections as labeled arrows.
- A connection that points at several entries, so "these three circle the same thing" is one record.
  Open: the shape for several targets, and whether the graph draws it as a node or a hyperedge.

### 5.8 Getting things in and out

- Importing existing writing, in some form (§6 has the candidates).
- Export and backup of the whole archive in a form that outlives the app, and restoring on a new
  device.

### 5.9 The app itself

- Finished light and dark themes, with a switch that remembers the choice.
- A polished install experience, on a phone home screen or a desktop.
- **No failure is silent.** An error the screen in use doesn't handle itself still reaches the
  writer, as a plain app-wide notice, never only the console. Failures with a known way forward (a
  draft changed in another tab, one that can't be reopened) stay where the writer can act on them.

---

## 6. May or may not

### Seeing the shape of things

- An optional nudge toward titling where an unnamed entry would cost legibility later (a
  many-target connection, anything a graph view must label). A nudge, never a requirement.
- Navigating by connection rather than by time.
- One entry's whole subtree as an activity stream: everything that ever happened to it, in order.
- Expanding past the default two levels of depth on demand.
- Pinning or color-coding the entries that matter.

### Writing history

- **Zooming in on the scrubber:** between two bookmarks, replay one keystroke at a time. More
  curiosity than reading tool, but the capture already supports it.
- Tuning how often moments get bookmarked, re-reading an old session under new rules, or turning
  capture off — and whether any of that is a user-facing setting at all.
- **Sittings:** a draft picked up again later records that it was, so the history view can show how
  many sittings a piece took. Without it, a return is only a long pause, indistinguishable from a
  tab left open.

### Drafts

- **Archiving a draft instead of discarding it**, which frees its entry for another draft (§4.8's
  one-per-entry block) without losing what was written — promise 2 kept, promise 5 intact, since
  an archived draft still never reaches the timeline. It keeps its text and authoring trace as-is.
  Restoring is best-effort: a related entry's own text always comes back, but anchors whose parent
  has since changed are dropped for the writer to place again. Archived drafts can still be deleted
  for good, so old ones don't pile up.
- **A draft that can't be reopened** (its start time won't parse) behaves the same from the Drafts
  list and from its entry. Today only the list shows its text, and as plain text. It could open
  read-only instead, formatting intact for copying. Or, when its trace still reads as a sensible
  sequence, the writer could choose to carry on with it under an estimated or fresh start time,
  knowing the history's timing is a guess.

### Making anchor ops unmistakable

Ordinary formatting, strikethrough included, can look like what an anchor op renders, so an anchor
op has to be distinct through its own presentation. Today that rests on italic-plus-color wording;
the dormant proofreader's markup (§4.4) would be stronger once it's back.

- Ordinary highlighting, belonging to no related entry, would collide with the comment anchor's
  yellow.
- Arbitrary text color, if ever added, would weaken the italic-plus-color signal.
- Anchor color schemes as a display setting: by op kind (today), auto-assigned per related entry,
  user-defined palettes, or by tag once tags exist.
- Inline vs. raised wording per anchor op, not one mode for everything. A strike with replacement
  wording reads naturally inline; added wording that doesn't flow with the original reads better
  raised above the line. The writer could set it per op.
- Numbering anchor ops so a passage and its explanation are obviously paired: per related entry, in
  document order, which under §5.4's lock changes only while that entry is being revised.
- Hovering an anchor shows which related entry it belongs to; a preview of it sitting near its
  passage.
- An overall "current state" presentation of an entry with all its related entries' anchors shown
  together.

### Extending what can be anchored

The anchor menu (§4.4) is contextual so these have somewhere to land:

- Anchoring a connection to a passage rather than to a whole entry.
- Anchoring to an image or caption. Images are block atoms, so this needs node-level anchor
  attributes rather than a mark.

### Getting things in and out

- Importing scanned journal pages or photos as an unfiled queue, turned into entries one at a time
  with your own context and dates — never bulk-creating entries nobody has read.
- Reading text off a scanned page to pre-fill a draft, still ending in human review.
- Importing from other journaling apps or plain text files.
- Printing or exporting one entry with its related entries and history attached.

### The writing experience

- Voice dictation.
- A distraction-free mode; templates or prompts for recurring kinds of entry; keyboard-first
  navigation throughout; checklists.
- Smart links with previews for common sources — above all, scripture references showing the full
  verse on hover (needs a network or a local cache; configurable?).

### The app itself

- Onboarding for a new, empty archive.
- An honest account in the interface that nothing is ever deleted, so the promise is discoverable.

### Bigger, later, maybe

- Audio and video entries.
- Ambient context (place, weather), probably from a third party rather than stored automatically.
- Encryption of the local archive.
- Syncing across devices, which changes several promises above and needs its own thinking.
- A desktop application shell.

---

## 7. Deliberately not doing

- **No account, no server, no cloud.** The design, not a default.
- **No social features.** Chronicle is for one person.
- **No deleting history.** Discarding an unsaved draft is the only thing that disappears, and it was
  never history.
- **No automatic entries.** Nothing enters the timeline that a person did not put there.
- **No AI writing the entries.** Whatever assistance exists, the writing is the user's.
