# Chronicle — Product Behavior

What Chronicle does, mostly as the writer sees it: the answer to "what should happen when I do this?", the thing a test is written against. Plain language where it's as short; the app's own terms or a code name where that's the simplest way to say it. How records are shaped is [ENTRY_MODEL.md](./ENTRY_MODEL.md); how writing is captured is [AUTHORING.md](./AUTHORING.md); the order work happens in is [CHRONICLE_PLAN.md](./CHRONICLE_PLAN.md).

- §4 is **built**. §5 is **decided**, not built. §6 **may or may not** happen: ideas go there the moment they occur so they stop taking up room in anyone's head. §7 is decided against.

---

## 1. What Chronicle is

A private notebook for a life: things that happened, things you thought about them, and the way those things connect. It runs entirely on your own device, works with no internet connection, needs no account, and never sends your writing anywhere.

Its distinguishing idea is that **nothing you write is ever overwritten**. Correcting an entry adds a new version rather than replacing the old one; commenting on a passage leaves the passage intact.

## <a id="promises"></a>2. Promises the product makes

A change that breaks one of these is a bug even if nothing else complains.

- **2.1 -** **It works offline.** Everything is on the device. Nothing waits on a network.
- <a id="nothing-lost"></a>**2.2 -** **Nothing you typed is lost.** Writing is saved continuously and survives a crash, a closed laptop, or a reload.
- **2.3 -** **Nothing fundamental is destroyed by a later action.** Edits, related entries, and corrections add; they never erase.
- **2.4 -** **You can always see how something got to be the way it is.**
- <a id="deliberate-history"></a>**2.5 -** **Nothing enters your history unless you put it there.** Saving is always a deliberate act.
- **2.6 -** **It should be readable in the dark.** No part of the design may make a dark theme impossible.

## 3. Vocabulary

| Word | Means |
| --- | --- |
| **Entry** | One record. Everything in Chronicle is one — a journal entry, one about it, a link between two. |
| **Timeline** | The list of entries, newest first. |
| **Related entry** | An entry about another, as a whole or about passages in it: an annotation or an update. |
| **Annotation** | A related entry about an entry, or about one passage in it. Claims nothing changed. |
| **Update** | A related entry that strikes wording or proposes different wording. Same shape as an annotation. |
| **Connection** | A link from one entry to another, with your explanation of why they relate. Directional. |
| **Revision** | A new version of an entry's own text. The previous version stays. |
| **Draft** | Writing in progress. Saved as you type, invisible to the timeline until you save it. |
| **Passage** | Text you selected inside an entry, which a related entry can be attached to. |

Two words are deliberately absent from the interface: "delete", in the sense of erasing history, and "edit", in the sense of replacing what was there. Annotation and update are never asked about either — they name what a related entry turned out to be, not a choice made before writing it.

---

## <a id="built"></a>4. Behavior today (Built)

### <a id="new-entry"></a>4.1 Writing a new entry

- **4.1.1 -** The app opens on the **New entry** page, ready to write. No "new entry" step first.
- **4.1.2 -** A title field sits above the toolbar: one line, plain text, no formatting. Enter moves into the body; Tab reaches the toolbar first, which is one Tab stop, with the arrow keys moving within it. **A title is optional** — much journal writing has no name worth giving, and a required field produces "Tuesday". Where only one line can be shown, an entry is named by its title, else its opening words. Related entries (§4.4) get the same optional field.
- **4.1.3 -** Optional details sit below the writing area, never collapsed, everywhere an entry is written, revising included. Each date is a day plus a free line for the time ("morning", "3:30 pm"), the way a paper journal says it. Two groups:
  - **When and where:** when the thing **happened**, and **where**.
  - **Written before, somewhere else:** when it was **originally written**, and what it was **written in** ("paper journal"), with a note ("blue Moleskine, 2014–2016").
- **4.1.4 -** The toolbar offers undo/redo, two heading levels, bold, italic, underline, strikethrough, bulleted and numbered lists, quotes, links, clear formatting, and adding an image. All of it works from the keyboard too, including markdown shortcuts such as `## ` and `- `.
- **4.1.5 -** **Bookmark this moment**, on the line saying the draft is saved as you write, marks where the writing stands, for the history view (§5.1) to stop at, wherever the caret is. Beside it, "Bookmarked at 3:41 PM" stays until the next one; nothing else shows a bookmark until that view exists. It belongs to the draft rather than the formatting, so it isn't in the toolbar.
- **4.1.6 -** Strikethrough here is ordinary formatting, like bold. A strike delivered by a related entry (§4.4) is a different gesture with its own presentation (§6.4).
- **4.1.7 -** **Everything typed is saved as a draft continuously**, within a fraction of a second.
- **4.1.8 -** Nothing appears on the timeline until **Save entry** is pressed. No autosave into history, no idle timeout.
- **4.1.9 -** Saving opens the new entry's own page (§4.3). **Discard** empties the page instead, throwing the draft away.
- **4.1.10 -** An entry needs a body, words or an image; a title alone can't be saved. Save stays pressable and says why, rather than greying out. A title typed on its own is still kept as a draft.

### <a id="timeline"></a>4.2 The timeline

- **4.2.1 -** Top-level entries, newest first, each as a card with its creation date, a preview, and its title if it has one (no stand-in label otherwise). A card also shows when the thing happened or was originally written, if given, and how many times the entry has been revised, if it has been.
- **4.2.2 -** Clicking a card opens that entry.
- **4.2.3 -** Related entries, connections, and revisions are not separate cards; they belong to their entry.
- **4.2.4 -** It has no writing area; entries are written on the New entry page (§4.1).

### <a id="reading-entry"></a>4.3 Reading an entry

- **4.3.1 -** Shows the title, the creation date, and the current text (the latest version), with whichever details were given (§4.1) below it, as when writing. An untitled entry is headed by the day it was written, set as a dateline ("Wed, Oct 7, 2026") rather than a title. The text is for reading: no editing controls appear until Revise. While a related entry or a revision is being written (§4.4, §4.5), the task heads the page instead, so the title is never shown twice.
- **4.3.2 -** A revised entry says which version you're looking at and how many exist.
- **4.3.3 -** Attached images appear where they were placed.
- **4.3.4 -** Related entries and connections attached to it are listed beneath, each showing what part of the entry it points at. Immediate ones are shown; deeper ones are indicated, not expanded.
- **4.3.5 -** A related entry's or connection's own page has a breadcrumb back to what it's attached to.

### <a id="writing-related"></a>4.4 Writing a related entry

- **4.4.1 -** An entry offers **Create related entry** and **Revise entry**: one way to say something about an entry, whether or not it points at a passage.
- **4.4.2 -** Creating a related entry opens two columns under the heading "Create related entry": the entry being written about on the left, headed as its own page heads it (its title or dateline, then its creation time and version), with how to mark it below its text; the new entry (with the same optional title and details as §4.1) on the right. This anchoring mode never mixes with revising the entry's own text ([ENTRY_MODEL.md, "Revising vs relating"](ENTRY_MODEL.md#revising-vs-relating)).
- **4.4.3 -** On the left, select a passage and a small menu offers **Highlight** or **Strike** (Ctrl+Alt+H / Ctrl+Alt+S); or place the cursor and type to propose wording right where it would go. Nothing else can change the entry's text from here.
- **4.4.4 -** Marking is optional. A related entry that marks nothing is about the entry as a whole, and the entry is not revised at all.
- **4.4.5 -** Wording attaches to a highlight or a strike alike, renders inline right after its passage, and reads as proposed from its colored underline, as track changes marks an insertion. It reads as part of the entry's text, so the entry's preview includes it. The underline runs under spaces, so wording that's only a space still shows; spacing around wording is whatever the author typed. A proofreader's-markup presentation (wording raised above the line, a caret on the baseline) exists but is dormant (`ANCHOR_MARKUP_MODE`): long wording overlapped trailing text on a packed line.
- **4.4.6 -** Saving anchors the passages and the related entry together in one action. The entry gains the anchors and nothing else, as a new version counted like any revision; its previous version stays as it stood. Saving opens the related entry's own page, whose breadcrumb leads back.
- **4.4.7 -** Annotation or update follows from what was marked, never asked: striking or proposing wording is an **update**; highlighting only, or marking nothing, is an **annotation**.
- **4.4.8 -** Related entries can themselves be annotated, to any depth.
- **4.4.9 -** Highlight or Strike leaves the cursor right after the passage, beside a greyed "Add wording…" placeholder. Typing there is its wording, typed into the entry like any text and outlined while the cursor is in it. Backspace, undo and paste work as in prose; a paste arrives as one line, and dropped text is ignored. There's nothing to accept: click or arrow away and the wording stays.
- **4.4.10 -** **Undo** and **Redo** sit above the entry on the left, where they are when writing, and take back or restore anchors and wording as Ctrl+Z does.
- **4.4.11 -** An anchor placed earlier in the same, still-open session can be returned to: clicking its passage puts the cursor at the end of its wording, and clicking the wording puts it where clicked. With the cursor there, the menu shows its kind pressed, switches highlight/strike (the same shortcuts), and removes it, wording and all. Wording with no passage offers only removing.
- **4.4.12 -** **Anchors are exclusive.** Highlight or Strike over a selection touching an existing anchor, its passage or its wording, even partly, returns to that anchor if this session placed it, and does nothing if an earlier related entry did. Once saved, an anchor is fixed; pointing differently at the same passage means writing another related entry. Resizing an anchor isn't offered; remove and recreate it.
- **4.4.13 -** Highlight color is a display setting, never stored with the related entry. Today it's one system scheme by anchor kind.

### <a id="revising-entry"></a>4.5 Revising an entry

- **4.5.1 -** **Revise entry** opens the entry's current text and title for editing, as a draft, under the heading "Revise entry"; the title shows only in its field. The entry is untouched until the revision is saved, and discarding leaves no trace.
- **4.5.2 -** Saving appends a new version; the old one stays and the version count goes up. Images are kept.
- **4.5.3 -** Renaming, or clearing the title, is an ordinary revision; old names stay with their versions. So is a change of formatting alone, such as bolding a passage.
- **4.5.4 -** **Anchored text is locked.** Existing anchors show while you edit, but the text under one, its wording, its kind, and their formatting, inline or block (bold, a heading or list over its paragraph), can't change. Deleting an anchor whole is refused too; typing against its outer edges is still fine, and Clear formatting leaves anchors alone, since an anchor isn't formatting. A refused edit silently does nothing. An anchor is removed only by deliberately revising the related entry that placed it (§5.4), so it never goes missing by accident. The lock exists to enforce that order, so history only moves forward, not to make removing an anchor hard.
- **4.5.5 -** Until revising a related entry exists, a saved anchor can't be removed at all, which is acceptable while nobody relies on the app.
- **4.5.6 -** Open: saying why an edit over an anchor did nothing. Likely a message on hovering a locked anchor, or one shown when an edit is refused, with controls left enabled.
- **4.5.7 -** Open: hiding the anchor menu over a selection where none of its actions could do anything, as on a sealed anchor, once that message says why.

### <a id="connections"></a>4.6 Connections

- **4.6.1 -** **Add connection** opens a full screen with the same tools as any entry (title, details, rich text) plus a choice of which entry it points to. A connection is an entry that also names a destination. Saving opens the connection's own page.
- **4.6.2 -** It has no separate label for how two entries relate: its title is its name on both ends, and like any title it is optional — untitled, it's named by its opening words.
- **4.6.3 -** It is visible from both ends, marked outgoing or incoming, and can be annotated and revised like any entry. Its related entries belong to the connection, not to either end.

### <a id="images"></a>4.7 Images

- **4.7.1 -** Images can be added while writing and appear inline. They are stored on the device and display offline. A failed attachment says so.

### <a id="drafts"></a>4.8 Drafts

- **4.8.1 -** A **Drafts** page lists every unfinished session, so nothing is stranded invisibly.
- **4.8.2 -** Each draft says what it would become — a new entry, a related entry on a named entry, or a revision of a named entry — with when it was last touched and a preview. It never says annotation or update, since an unsaved draft hasn't settled that (§4.4).
- **4.8.3 -** A draft resumes where it left off, on the page it was started from, exactly as it would from there. It's saved or discarded on that page, or discarded from the list. Saving opens the entry it became, or for a revision, the entry it revised. Drafts never appear on the timeline.
- **4.8.4 -** **A draft that isn't saving says so**, in place of the line saying it's saved, with **Try again**. Until a save lands, what's written is only in that tab, so closing or reloading it asks first. It steers the writer to reopen the draft rather than start over, which would lose its writing history.
- **4.8.5 -** A draft that can't be reopened (its start time won't parse) says so wherever it's resumed, and shows everything in it read-only, formatting and anchors intact, to copy before it's discarded.
- **4.8.6 -** **One outstanding draft per entry, so versions never branch.** Opening a revision or a related entry (whose anchors revise the parent) starts a draft on that entry at once, and until it's saved or discarded the entry offers **Resume draft** in place of Revise and Create related entry, in every tab. Only one change to an entry can be in progress, the price of a history with nothing to merge. Leaving the draft without changing anything removes it; one open when its tab closes stays on the Drafts page. If the version a draft started from has been replaced anyway (only two tabs starting at the same moment get past the block), it says so once opened, or when saving a change is refused. A revision then shows read-only, as one that can't be reopened does. A related entry can still be saved with nothing marked. Either way the draft stays until it's discarded, unless nothing in it was changed.
- **4.8.7 -** **Two tabs never diverge.** Leaving a tab saves its draft at once. Returning to a tab first loads any newer version of its draft, closes one saved or discarded elsewhere and says so, and shows the entry's latest version, so nothing is revised from a stale one. If two tabs save at once, the first wins and the other shows its own text to copy.

### 4.9 Keeping it on this device

- **4.9.1 -** At startup Chronicle asks the browser to keep its storage through the browser's own clean-ups when space runs low. If the browser declines, a quiet, dismissible line says so and suggests installing Chronicle, which usually earns it. Nothing in the browser protects against clearing the site's data; only a backup outside it can (§5.8).

### <a id="writing-history"></a>4.10 How writing is remembered — Invisible for now

While you write, Chronicle records how the text came to be, not only the result. Each change carries signals: a pause, a paste (a drop doesn't count), an image, a finished sentence. Which of those add up to a bookmark worth returning to is decided later, not while you write, so bookmarking can be retuned at any point and reach back over everything already written. Nothing displays it yet; it is what the history view (§5.1) plays.

---

## <a id="decided"></a>5. Decided, not built

### <a id="history-scrubber"></a>5.1 Scrubbing an entry's history — Next

A view of one entry that can be dragged back through time, showing the entry as it stood at each moment — across versions and, within a writing session, at each bookmark. It plays as a chain, one frame per bookmark: the document grows or recedes mark by mark, each frame's change highlighted, deletions struck through. It should feel like the global timeline, not a separate tool. What it plays can already be computed; the view is what's missing. If a session's history can't be replayed all the way to what was saved, the view says where it ends rather than stopping silently.

### <a id="history-diff"></a>5.2 Showing what a revision changed — Next

When looking at a revision, show what changed since the version before it — additions and removals marked the familiar way. A renamed title shows as its own plain-text change. A change of formatting alone shows too, as formatting rather than as words, so a bold-only revision never reads as having changed nothing. Open: comparing any two versions, or several; and whether anchor ops belong in such a view.

### 5.3 Known gaps

- **5.3.1 -** **A related entry's own page doesn't show what it marked.** It says which entry it's about, but its strikes and highlights show only on that entry, so landing on it after saving (§4.4) doesn't show what was just done. Likely fix: keep some of that entry, and what was marked, in view.

### <a id="revising-related"></a>5.4 Revising a related entry

- <a id="revise-reopens"></a>**5.4.1 -** **Revise** on a related entry reopens the two-pane experience of §4.4 rather than plain editing: the parent's latest version on the left, the related entry's latest version on the right.
- <a id="own-anchors"></a>**5.4.2 -** On the left, the related entry's own anchors behave like ones placed in the current session: return to one, switch highlight/strike, edit or remove wording, or remove the anchor. They can also be reshaped while keeping their identity and their wording: unmark part of one to shrink it, or extend it over adjacent text. New anchors can be added. Every other related entry's anchors show but can't be touched, and nothing else on the left can change, as in any related entry.
- <a id="saves-either-side"></a>**5.4.3 -** Saving revises whichever side changed, together: the related entry, the parent's anchors, or both. It stays about its parent for good; it can't be revised into a freestanding entry.
- <a id="kind-follows-anchors"></a>**5.4.4 -** Annotation or update follows its current anchors, so a revision that removes its last strike and wording makes it an annotation.
- <a id="one-way-to-remove"></a>**5.4.5 -** This is the one way to remove an anchor, since §4.5's lock keeps every other editor off it.
- **5.4.6 -** Anchors stay exclusive (§4.4): a passage belongs to at most one related entry, so a lock never has two owners. Saying something different about an anchored passage means revising the related entry that holds it.
- <a id="outstanding-against-both"></a>**5.4.7 -** Revising a related entry is a draft like any other (§4.8), listed as a revision of it, and is outstanding against both it and its parent.
- <a id="grouped-anchors"></a>**5.4.8 -** Reading a parent with several related entries offers its anchors grouped by related entry.

### <a id="finding"></a>5.5 Finding things

- **5.5.1 -** Full-text search across entries, related entries, and connections.
- **5.5.2 -** Filtering by kind, date range, tag, and whether an entry has been revised.
- **5.5.3 -** **Tags**, as a real filterable thing rather than a note inside the text.

### <a id="timeline-views"></a>5.6 Timeline views

- **5.6.1 -** **What the timeline becomes:** visual rather than a list, likely horizontal, showing entries as cards under the writer's own filters and search (§5.5). Today it's a plain list (§4.2).
- **5.6.2 -** Ordering by when entries were added or by when things happened.
- **5.6.3 -** Choosing what the timeline contains: titled related entries as cards of their own, and revisions as their own cards (how often was this reworked?) or hidden.

### <a id="connecting"></a>5.7 Connecting entries

Replaces §4.6: a connection stops being its own kind of entry and becomes something any related entry can do.

- **5.7.1 -** **A connection is a related entry that also points at other entries**, its targets. "Connection" stays the word for the line, not for a kind of entry.
- **5.7.2 -** **It's written in three columns**: the entry it's about, the connection, and one target, with passages highlightable in both outer columns as in §4.4. A picker in the third column chooses the target: a new one, or, when revising, one it already has.
- **5.7.3 -** **Its highlights in the entry it's about are one set for the connection, not one per target**, and each target has its own. A different passage relating to a different target is a second connection.
- **5.7.4 -** **Saving revises whichever of the three changed, together**: the connection, and the entry or target if something was highlighted in it, which gains a version with its text unchanged, as in §4.4. A session works on one target at a time, and its draft is outstanding against all three (§4.8). Revising a connection's highlights builds on §5.4.
- **5.7.5 -** **Switching the third column to another target** is free until something in the current one has changed. After that, switching first warns that this session's changes there will be dropped; the connection's writing and its highlights in the entry it's about stay. A target with a draft of its own open can't be picked or removed until that draft is saved or discarded, and says so.
- **5.7.6 -** **A light connection needs nothing written.** **Connect to…** on an entry draws the line in one step; revising it later can add the explanation.
- **5.7.7 -** **Several targets**: one connection can point at several entries, so "these three circle the same thing" is one entry rather than three connections. Targets are picked one at a time, since not every one is known at once.
- **5.7.8 -** **After saving, targets change only by revising the connection**, in the same three columns, so adding or removing one waits while a draft on the connection is open (§4.8). Removing a target removes what was highlighted in it, so when there's anything, a warning says so first; it all stays in the target's history. **Add target** is offered on any related entry, so one with no targets becomes a connection when it gains its first.
- **5.7.9 -** **Either end, viewed as it stood before a change, still shows the old line**, and the connection's versions show every change. Neither end is written to unless a passage in it is highlighted, so the connection alone carries the line's history, as a related entry alone carries its own.
- **5.7.10 -** **A connection whose targets are all removed** stays with the entry it's about, as an ordinary related entry. A light one, with nothing written, leaves current views and stays in history.
- **5.7.11 -** **The entry a connection is about never changes**, as for any related entry (§5.4). One started from the wrong entry is fixed by removing its targets and connecting again from the right one.
- **5.7.12 -** **A graph view:** entries as nodes, connections as lines. Open: how one with several targets is drawn.
- **5.7.13 -** Open: **whether a top-level entry may have targets**, so a new entry can point at older ones without being about any one of them. "These three circle the same thing" has no natural entry to be about. Lean yes: it's one rule fewer.

### <a id="in-and-out"></a>5.8 Getting things in and out

- **5.8.1 -** Importing existing writing, in some form (§6.7 has the candidates).
- **5.8.2 -** Export and backup of the whole archive in a form that outlives the app, and restoring on a new device.

### 5.9 The app itself

- **5.9.1 -** Finished light and dark themes, with a switch that remembers the choice.
- **5.9.2 -** A polished install experience, on a phone home screen or a desktop.
- **5.9.3 -** **No failure is silent.** An error the screen in use doesn't handle itself still reaches the writer, as a plain app-wide notice, never only the console. Failures with a known way forward (a draft changed in another tab, one that can't be reopened) stay where the writer can act on them.
- **5.9.4 -** **An error says it's an error, not only in red.** Each one gets an icon, and a screen reader hears "Error:" before the message, from text hidden on screen, so the kind comes first for everyone. One shared message replaces the hand-written ones. Anything shown in red is announced as an error; today the notice for a draft on a replaced version is red but announced as a polite status. Polite notices stay on the page and change only their words, since one added with its words already in it may not be read out.

### 5.10 Responsiveness — Later, in one pass

Chronicle is built for a desktop window first. Fitting narrow screens happens later, all at once, rather than page by page as each is built, so until then a page needn't be laid out with a phone in mind. Ideas for that pass collect here:

- **5.10.1 -** Side-by-side columns (§4.4's two, §5.7's three) show one at a time, with a way to switch between them.

---

## <a id="maybes"></a>6. May or may not

### 6.1 Seeing the shape of things

- **6.1.1 -** An optional nudge toward titling where an unnamed entry would cost legibility later (a many-target connection, anything a graph view must label). A nudge, never a requirement.
- **6.1.2 -** Navigating by connection rather than by time.
- **6.1.3 -** Stepping from an entry to the one before or after it in time.
- **6.1.4 -** One entry's whole subtree as an activity stream: everything that ever happened to it, in order.
- **6.1.5 -** Expanding past the default two levels of depth on demand.
- **6.1.6 -** Pinning or color-coding the entries that matter.

### 6.2 Writing history

- **6.2.1 -** **Scrubbing backward** could fade later marks out after a slight delay rather than cutting them.
- <a id="zoom-scrubber"></a>**6.2.2 -** **Zooming in on the scrubber:** between two bookmarks, replay one keystroke at a time. More curiosity than reading tool, but the capture already supports it. Replaying forward from the earlier bookmark can keep each keystroke's inverse as it goes, so stepping back is as cheap as stepping forward.
- <a id="bookmark-tuning"></a>**6.2.3 -** Tuning how often moments get bookmarked, re-reading an old session under new rules, or turning capture off — and whether any of that is a user-facing setting at all. Most likely as a few saved presets for which kinds of moment to stop at, picked between while scrubbing ([CHRONICLE_PLAN.md, "Mark sets replaced by filter presets"](CHRONICLE_PLAN.md#filter-presets)).
- <a id="draft-history-view"></a>**6.2.4 -** **The history view on a draft in progress:** §5.1's scrubber in a collapsible section of the composer, playing the session's live log, for the writer curious how writing history is made. Marks are derived from the log, so it can stop at them before anything is saved. Bookmark this moment would move into its header, visible even while it's collapsed. Beyond §5.1 it needs a live feed of the log and a replay that keeps up with typing.
- **6.2.5 -** **Sittings:** a draft picked up again later records that it was, so the history view can show how many sittings a piece took. Without it, a return is only a long pause, indistinguishable from a tab left open.

### 6.3 Drafts

- **6.3.1 -** **Archiving a draft instead of discarding it**, which frees its entry for another draft (§4.8's one-per-entry block) without losing what was written, keeping promises §2.2 and §2.5, since an archived draft still never reaches the timeline. It keeps its text and authoring trace as-is. Restoring is best-effort: a related entry's own text always comes back, but anchors whose parent has since changed are dropped for the writer to place again. Archived drafts can still be deleted for good, so old ones don't pile up.
- <a id="revision-edited-back"></a>**6.3.2 -** **A revision edited back to where it started** is released when left, and its typing goes with it, since saving it would add a version identical to the last. Archiving could keep it instead, as a session with a history and no result.
- **6.3.3 -** **A draft that can't be reopened** can only be read (§4.8), and until it's discarded it still blocks its entry. Once archiving exists, it could be archived automatically, freeing the entry, and never restored to editing. Or, if its entry hasn't moved past the version it started from and its trace still reads as a sensible sequence, the writer could carry its history onto a fresh draft under a start time they estimate, knowing the history's timing is a guess.
- **6.3.4 -** **More kinds of damage, each named.** A start time that won't parse is the only damage a draft is shown read-only for. Others may join it as they're found, each one specific, rather than any failure to reopen counting as damage: a draft a bug failed to open would then offer only Discard, though nothing in it was wrong.

### <a id="unmistakable-anchors"></a>6.4 Making anchor ops unmistakable

Ordinary formatting, strikethrough and underline included, can look like what an anchor op renders, so an anchor op has to be distinct through its own presentation. Today that rests on underline-plus-color wording; the dormant proofreader's markup (§4.4) would be stronger once it's back.

- **6.4.1 -** Ordinary highlighting, belonging to no related entry, would collide with the comment anchor's yellow.
- **6.4.2 -** Arbitrary text color, if ever added, would weaken the underline-plus-color signal.
- <a id="color-schemes"></a>**6.4.3 -** Anchor color schemes as a display setting: by op kind (today), auto-assigned per related entry, user-defined palettes, or by tag once tags exist.
- **6.4.4 -** Inline vs. raised wording per anchor op, not one mode for everything. A strike with replacement wording reads naturally inline; added wording that doesn't flow with the original reads better raised above the line. The writer could set it per op. Raised wording would show inline while the cursor is in it, since typing into text positioned out of flow is unreliable.
- <a id="numbered-anchors"></a>**6.4.5 -** Numbering anchor ops so a passage and its explanation are obviously paired: per related entry, in document order, which under §5.4's lock changes only while that entry is being revised.
- **6.4.6 -** Hovering an anchor shows which related entry it belongs to; a preview of it sitting near its passage.
- **6.4.7 -** An overall "current state" presentation of an entry with all its related entries' anchors shown together.

### 6.5 Extending what can be anchored

The anchor menu (§4.4) is contextual so these have somewhere to land:

- **6.5.1 -** Anchoring to an image or caption. Images are block atoms, so this needs node-level anchor attributes rather than a mark.

### 6.6 Images

- **6.6.1 -** An image attached to the entry as a whole rather than placed in its text (§4.7): either standing apart from its versions, or added as a version of its own.

### <a id="in-and-out-maybes"></a>6.7 Getting things in and out

- **6.7.1 -** Importing scanned journal pages or photos as an unfiled queue, turned into entries one at a time with your own context and dates — never bulk-creating entries nobody has read.
- **6.7.2 -** Reading text off a scanned page to pre-fill a draft, still ending in human review.
- **6.7.3 -** Importing from other journaling apps or plain text files.
- **6.7.4 -** Printing or exporting one entry with its related entries and history attached.

### 6.8 The writing experience

- **6.8.1 -** Voice dictation.
- **6.8.2 -** A distraction-free mode; templates or prompts for recurring kinds of entry; keyboard-first navigation throughout; checklists.
- **6.8.3 -** Smart links with previews for common sources — above all, scripture references showing the full verse on hover (needs a network or a local cache; configurable?).

### 6.9 The app itself

- **6.9.1 -** Onboarding for a new, empty archive.
- **6.9.2 -** Choosing which page the app opens on, rather than always New entry (§4.1).
- **6.9.3 -** An honest account in the interface that nothing is ever deleted, so the promise is discoverable.

### 6.10 Bigger, later, maybe

- **6.10.1 -** Audio and video entries.
- **6.10.2 -** Ambient context (place, weather), probably from a third party rather than stored automatically.
- **6.10.3 -** Encryption of the local archive.
- **6.10.4 -** Syncing across devices, which changes several promises above and needs its own thinking.
- **6.10.5 -** A desktop application shell.

---

## <a id="not-doing"></a>7. Deliberately not doing

- **7.1 -** **No account, no server, no cloud.** The design, not a default.
- **7.2 -** **No social features.** Chronicle is for one person.
- **7.3 -** **No deleting history.** Discarding an unsaved draft is the only thing that disappears, and it was never history.
- **7.4 -** **No automatic entries.** Nothing enters the timeline that a person did not put there.
- **7.5 -** **No AI writing the entries.** Whatever assistance exists, the writing is the user's.
