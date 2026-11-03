# Simplify Track B, wording as marked text, and Track A's unreviewed files

Status: commits 0–8 done.

## Context

Source gets simplified before the review goes much further into tests. CODE_REVIEW.md already lets "an improvement land when it's ready, whatever layer it's in". This plan front-loads that, from a read of every Track B file and Track A's unreviewed ones. It also brings CHRONICLE_PLAN.md item 4 (anchor wording as marked text) forward. Tests change here only where the source they prove changes. This file is deleted when the plan is done, once anything lasting has moved into the docs.

The weight is in three files:

- **`DocumentEditor.vue`, 1,135 lines, doing five jobs:**
  - one document's session: steps, signals, affected anchors;
  - the title field, which rides every document change;
  - the formatting toolbar, with its link field, More menu and image attach;
  - anchor mode's click and typing hooks;
  - about 220 lines of CSS.
- **`anchorCommands.ts`, 645 lines (35% comments),** half of it the wording box.
- **`AnchorInsertView.vue`, 230 lines:** the box's `<input>`.

The domain and read side are lean: `marks`, `replay`, `markFrames`, `documentDiff`, `reconstructEntryState`, `entryValidation` and the repositories. Afterwards DocumentEditor's change contract describes one document, and wording is typed like prose. That gives every signal, undo per keystroke and character-level frames, as CHRONICLE_PLAN.md item 4 lays out.

## Decisions

"Item N" is CHRONICLE_PLAN.md's priority N as of 2026-10-31, before commit 0: item 2 is connections, item 3 session tracking, item 4 anchor wording as marked text. Commit 0 takes items 3 and 4 out of that list, so connections stays item 2 and the later numbers move up. "Commit N" is one of this plan's own.

- **This plan comes before item 2 (connections folded into related entries). The two are mostly independent: this plan changes the editor and the document's shape, and item 2 changes the model and the draft.** Doing this plan first wins in two ways:
  - §5.7's composer highlights passages in the target "as in §4.4", so item 2 builds on the anchor-mode editor. Done first, item 2 would build on the wording box that item 4 deletes.
  - This plan shrinks what item 2 must touch:
    - `recordFields` gives `targets` a home beside the document;
    - a single Dexie version takes item 2's new targets index as a one-line edit;
    - the adapters lose their test-only API before item 2 reworks `listDescendants`;
    - the title stops riding the change path that the three-column composer will triple.

  Where the two plans meet (`useDraftSession`'s parent refs, `entriesStore.inputsForDraft`, `anchors.ts`), this plan changes little or nothing.

- **PRODUCT.md §5.4 (the lock, and Revise on a related entry) is entirely out of this plan.** The one part that is in: the guard is built over sets of editable and locked ranges, so §5.4 only passes more ranges.
  - **What the lock is for:** it enforces an order of operations. Remove or reshape an anchor from the related entry first, then revise the parent, so history only moves forward.
  - **Why it waits:** the first step needs Revise on a related entry. That shares two foundations with item 2:
    - versioned relation state: a related entry's anchors, and item 2's targets, become part of its version, with annotation/update derived from the current one;
    - a draft whose anchor-revised documents are a list keyed by entry: today's parent, §5.4's parent, a connection's targets.

    So item 2 is planned starting from those two foundations, and §5.4 follows it. Locking before then would make the order impossible rather than enforced.

- **Item 3 is not built.** Its main job, tracking which anchors a revision disturbed, is the warning §5.4's lock replaces. Held scaffolding steps stay in `onUpdate`, which becomes simpler once the title leaves it. Commit 0 folds item 3 into §5.4 in CHRONICLE_PLAN.md.
- **Wording is typed into the document: there is no `<input>`, and no box state.** Today's flow becomes:
  1. Select a passage and press Highlight or Strike. The caret lands right after the passage, inside a small outlined box with a greyed "Add wording…" placeholder, much as today's box looks. The box and placeholder are decorations drawn around the document's own text, not a separate field.
  2. Type. The letters go into the document there, italic and anchor-colored inside the outline. Backspace, undo and paste work as in prose; a paste now counts as a paste.
  3. Move on: click elsewhere, or arrow out. The outline goes, and the wording stays inline after its passage. There's no Accept step; Enter and Escape do nothing there, and undo replaces Escape-restore.
  4. Come back: click the passage or the wording. The caret returns to the end of the wording, the outline reappears, and AnchorMenu offers Highlight/Strike/Remove.

  To propose wording with no passage, place the caret anywhere and type, as now. Screen readers hear the wording as part of the document, and the live region still announces placing, switching and removing.

- **The title is a plain field per version, with no steps and no writing history.** ENTRY_MODEL.md already says this: edited in an `<input>`, "absent from the authoring trace", "folded through the version chain like the dates". The draft holds its latest value, and sealing copies it, whole, into the new version. Commit 3 makes the code match. Today each title keystroke travels as a step-less document change, and after commit 3 it goes straight into the draft's fields.
- **A Bookmark button in EntryComposer** (commit 5). `draftsStore.addMark`, the trace's `manual` event and `deriveMarks`' top-priority `manual` reason are all built, but nothing in the UI calls them. A bookmark shows nowhere until the history view (§5.1), but it's recorded from now on.
  - It sits on the draft's "Saved as a draft" line, not in the toolbar: it acts on the draft's trace, not the document, and the toolbar's every action is a command on its editor. In the toolbar, DocumentEditor would relay something that isn't its document, which is what commit 3 takes the title out of.
  - Rejected: a marker in the text, since a bookmark is a moment of the whole document rather than a place in it, and a position would vanish on reload unless `ManualEvent` stored one.
- **AnchorMenu is the one control surface.** Over a selection it offers Highlight and Strike, as now. With the caret on an anchor this session placed, it offers Highlight/Strike pressed for that anchor's kind (absent for a bare insertion), plus Remove. Ctrl+Alt+H/S switch the kind from the caret.
- **Sealed wording, in any editor, can be removed only whole.** That is today's rule for the atom: a revision can't type into it, but a deletion that covers it goes through and warns. §5.4 later locks passage and wording together.
- **The interlinear presentation stays parked.** The wording mark renders the same `<ins class="chronicle-anchor-insert"><span class="chronicle-anchor-wording">` shape, so the parked CSS keeps applying. Only its `.chronicle-anchor-insert-box` selector becomes the open-wording decoration's class. If it's ever revived, wording would show raised only while the caret is elsewhere, since typing into absolutely positioned text is unreliable.
- **Parallel change for item 4: expand, migrate, contract.**
  1. The readers learn the mark beside the node.
  2. The editor writes the mark.
  3. The node is deleted.

  Each step is green and readable on its own. The dual reading lives two commits and is never a fallback for stored data: old local data with `anchorInsert` nodes is cleared, not tolerated (CLAUDE.md). Rejected: one commit, which would be the plan's largest diff by far.

- **The guard is pure** (`editor/anchorGuard.ts`), judged per step against ranges as they stand before that step, and node-tested on a bare `EditorState`. CLAUDE.md's landmark "schema and the guarded, anchor-aware document commands live only in `extensions.ts` and `anchorCommands.ts`" gains `anchorGuard.ts`.
- **The title is its own field, beside the editor, as the details are** (commit 3).
  - The problem: ENTRY_MODEL.md calls the title a plain field beside the document, but `handleTitleInput` emits a fake change with every signal false. Because that change's content already includes held scaffolding steps, they ride along with it, and `TraceRecorder.record` grew a step-less guard (3c75475) for it.
  - EntryComposer holds the title's `<input>` above the editor, as prominent as before, and reports the raw value. `isBlankDraft` and `normalizeTitle` already trim. While a save is in flight the input is disabled, as the editor is, rather than swapped for text; only a read-only draft shows it as text. DocumentEditor drops the title and is left with the document alone, plus an exposed `focus()` for Enter and Tab to hand over to.
  - RelatedEntryComposer shows the parent's title itself, as static text above the parent's editor.
  - In the session, title and details are one shallow `fields` value with one `handleFieldsChange`. In the store, `recordDetails` widens to `recordFields(sessionId, Partial<DraftFields>)`, the one way in for every field beside the document, including item 2's targets later. Since the session hands over plain data, the store's copy of `dates` and `entryDetailsOf` go.
  - The recorder's step-less guard goes: nothing sends a step-less change any more, so it fails CLAUDE.md's remove-the-line check.
  - Rejected:
    - keeping the field in DocumentEditor, reporting through `update:title`, which leaves the editor relaying a field that isn't its document;
    - a header slot inside the editor's box, which keeps the relay as a slot prop;
    - folding the title into EntryDetailsFields, which renders below the body and whose details §4.3 lists under the text;
    - its own component, which only EntryComposer would use: every view that shows a title renders it its own way, and their shared text logic is `entryLabel`.
- **The formatting toolbar is one Tab stop** (commit 4), by the APG toolbar pattern that AnchorMenu already follows: a roving tabindex, with arrow keys moving within it. It declares `role="toolbar"` today but makes every control a Tab stop. Once it costs one press, the title's Tab-skips-the-toolbar shortcut goes, and focus order is the same both ways. Enter still moves from the title into the body.
- **The toolbar is its own component**, `EditorToolbar.vue`, as AnchorMenu is for anchor mode. Its `editor` prop is `@tiptap/vue-3`'s `Editor`, whose state is reactive; `@tiptap/core`'s is not. The same goes for AnchorMenu once it reads the anchor at the caret.
- **Remove the Attachments list on an entry's page.** Images already show inline, where they were placed.
- **One Dexie schema version.** Dexie diffs a lone declared version against the installed schema: `updateTablesAndIndexes` rebuilds the old schema, and `deleteRemovedTables` drops `draftSteps`. Keeping the number at 5 means an existing browser opens with no upgrade.

## Commits

Each: `npm run typecheck`, each new test seen failing first, and the specs named.

Order and dependencies:

- 0 comes first.
- 1–7 stand alone, except 5, which comes after 4.
- 8 is the spike. 9–12 are item 4, in order, after 7.
- 13 and 20 are skipped.
- 14–19 are independent.
- FILE_SPECS.md commit 2 (the `useDraftSession` spec) comes after commits 3 and 5 here, and covers `handleFieldsChange` and `bookmark`.
- Commits here and in FILE_SPECS.md that touch EntryDetailView's pairs rebase on whichever lands first.
- Last, once the rest are in: delete this file, and every citation of it in CHRONICLE_PLAN.md, CODE_REVIEW.md and FILE_SPECS.md.

0. **Check the plan in and set the order.**
   - Write this plan to `SIMPLIFY.md` at the repo root, beside CODE_REVIEW.md and FILE_SPECS.md, and keep its Status current from then on. Code comments never cite it (CLAUDE.md).
   - CHRONICLE_PLAN.md:
     - Priority 1 (Review) gains this plan as the source simplification it front-loads, with anchor wording done inside it. That item leaves the numbered list; its "Decided engineering work" entry points here until commit 12 removes it, and this plan wins where the two differ.
     - Session tracking leaves both the priorities and "Decided engineering work". Connections' line gains that §5.4 follows it, on the two foundations they share, and that §5.4's lock replaces the warning session tracking served.
     - Seed data keeps its constraint: after anchor wording, since a seed's trace records whichever document shape exists.
   - CODE_REVIEW.md and FILE_SPECS.md name what items 3 and 4 were rather than their numbers, and the history view's number follows the list.
   - Verify: `npx prettier --check` on the four docs.

### Track B

1. **Drop `EditorChange.anchorIds`, which nothing reads.** The seal derives the same thing from the documents (`anchorsPlacedSince`, `entriesStore.inputsForDraft`).
   - Remove the field, its doc comment and the import. Fold `sessionAnchorIds` into its one caller, `anchorsPlacedSince`, with its three cases.
   - Trim the comments explaining why nothing forwards it (`handleParentChange`, `recordParentChange`).
   - In DocumentEditor's pair, delete the `anchorIds` assertions; each sits beside a `collectAnchors(change.content)` check. The resume test already asserts `anchorsPlacedSince(base, …)` against the base.
   - Verify: `npm run test -- src/domain/anchors.test.ts`; DocumentEditor pair.

2. **`markAnchor` reads the selection itself.** Its `range` parameter's one caller, `handleAnchorMark`, passes `instance.state.selection`, which is the default, under a comment citing a note that doesn't exist.
   - Drop the parameter.
   - AnchorMenu already holds the `editor`, so it calls `markAnchor(editor, kind)` itself, as AnchorInsertView calls its commands. The `mark` emit and `handleAnchorMark` go.
   - Verify: DocumentEditor pair (anchor mode).

3. **The title is its own field** (Decisions).
   - DocumentEditor: the title field, its props, `handleTitleInput`, the fake change, `emittedTitle` and `EditorChange.title` go, and `withHeldSteps` is inlined into its one caller. `focusBody` becomes the exposed `focus()`.
   - EntryComposer: the title's `<input>` above DocumentEditor, raw, disabled while saving, and text when read-only, or nothing when blank. Enter and Tab call the editor's `focus()`. The title and EntryDetailsFields share one `handleFieldsChange`, which clears `error`. RelatedEntryComposer renders `parentTitle` itself.
   - Store and session: `DraftChange` loses `title`, and `recordDetails` becomes `recordFields`, with no copy. `useDraftSession`'s `title` and `details` become one shallow `fields`, with `handleFieldsChange`. `entryDetailsOf` goes.
   - `TraceRecorder.record` loses its step-less guard and that test.
   - Behavior changes:
     - Intended: a title-only revision of a document ending in a heading seals a null trace instead of one scaffolding-only edit.
     - Newly, a change to a detail field clears why Save did nothing, as `error`'s doc already said.
     - Newly, the title stays an input while saving, disabled, rather than turning into text.
   - Tests:
     - DocumentEditor's title tests go.
     - EntryComposer gains:
       - the title reaching the draft as typed, spaces and all;
       - Enter, and Tab, into the body;
       - the title kept in place, disabled, while a save is in flight;
       - "clears why it couldn't save once the title changes";
       - in the unreadable-draft case, no Title textbox.
     - `draftChangeTo` drops `title`, and `draftsStore.test.ts`'s retitle case uses `recordFields`.
   - Docs: ARCHITECTURE.md's write-path labels and EntryComposer box, then `npm run diagram` and look at both renders. draftsStore is reviewed (REVIEW.md, 2026-10-30), so the summary names the rename.
   - Verify: `npm run test -- src/stores/draftsStore.test.ts src/domain/traceRecorder.test.ts`. It's a store change, so the full component suites (`npm run test:browser`, `npm run cy:run`).

4. **Extract `EditorToolbar.vue`, as one Tab stop** (Decisions).
   - What moves: `ToolbarAction`, `toolbarGroups`, the text-style select, the link field with `openLink`/`applyLink`, the More menu with its outside-pointerdown listener, `clearFormatting`, and the image attach (`fileInput`, `handleFiles`, `attachError`, `useMedia().store`), each with its template. One root element.
   - DocumentEditor keeps `media.applyTo`.
   - The link input's hard-coded `id="editor-link-url"` takes `useId()`, so two text-mode editors on a page can't share it.
   - New pair on a vue-3 `Editor` attached to the document, with retrying assertions:
     - a toggle's `aria-pressed` follows the selection, and clicking it runs its command;
     - undo and redo are disabled with nothing to undo;
     - the select shows and sets the block type;
     - Link opens seeded with the link under the caret and applies it, and an empty address removes it;
     - More closes on Escape (focus back on its toggle) and on a pointerdown outside;
     - `disabled` disables every control;
     - Add image stores the file and inserts its node.
   - DocumentEditor's pair keeps its image test for `media_changed` and the filled-in `src`, and its link test's `is_formatting`. "Leaves the caret in the document after a toolbar click" moves to the new pair.
   - The Tab stop:
     - AnchorMenu's roving tabindex moves into a composable that both toolbars use.
     - Check what Left and Right do in the text-style select before choosing its place in the roving order, since a closed `<select>` may take them itself.
     - The title's Tab shortcut in EntryComposer goes; Enter stays.
     - PRODUCT.md §4.1: "Enter or Tab moves into the body" becomes Enter alone, with the toolbar one Tab stop between them.
     - Tests: the EditorToolbar pair proves one Tab stop and the arrow keys; EntryComposer's Tab case becomes a Tab that lands on the toolbar.
   - Verify: the EditorToolbar, AnchorMenu, DocumentEditor and EntryComposer pairs.

5. **A Bookmark button in EntryComposer** (Decisions).
   - EntryComposer's "Saved as a draft" line gains "Bookmark this moment" (lucide `Bookmark`), disabled while saving, keeping the caret where it was. A visible polite status beside it says "Bookmarked at 3:41 PM" (`formatTime`) until the next bookmark. The time alone: it lasts only for one page visit, so it's from another day only in a tab left open past midnight. The line's sentence says the draft keeps its writing history, and the button's tooltip says the bookmark marks a point in it.
   - Wiring: the button calls `session.bookmark()`, which calls `drafts.addMark`, already built and tested, and sets the session's `bookmarkedAt`. That lives on the session, cleared in `openAs`, because NewEntryView's Discard begins the next session in the same tick, so the composer isn't remounted and a ref of its own would outlive its draft. It works in every composer: a new entry, a revision, a connection, and a related entry's own prose.
   - Tests: the EntryComposer pair. A bookmark reaches `session.bookmark` and shows its time, and the in-flight save test finds Bookmark disabled.
   - Docs: PRODUCT.md §4.1 gains the button, and that nothing shows a bookmark until the history view (§5.1). AUTHORING.md's "a `manual` event is a bookmark the writer asked for" names the button.
   - Verify: the EntryComposer pair, and the EditorToolbar and DocumentEditor pairs unchanged.

6. **One document walk.** `walk` is defined twice, verbatim. Export it from `entryDocument.ts`, which `anchors.ts` already imports from.
   - Verify: `npm run test -- src/domain/`.

7. **Signals as a pure function**, `editor/changeSignals.ts`: `changeSignals(transaction, after)` returns `ChangeSignals`. It replaces `insertedTextOf`, `removedTextOf` and the delta logic in `onUpdate`.
   - It reads steps by class (`instanceof ReplaceStep`/`ReplaceAroundStep` from `@tiptap/pm/transform`, as `markFrames.ts` does), with none of today's casts or per-step `toJSON`.
   - The wording-box meta stays until commit 10.
   - A node spec on an `EditorState` from the editor's schema covers:
     - typing;
     - a selection replaced by longer text (it still counts the removal);
     - a list wrap (no deletion);
     - bold, and a heading (formatting);
     - paste meta, and drop meta (which isn't a paste);
     - an image (`media_changed`);
     - an anchor mark (`is_anchor_op`, not formatting).
   - DocumentEditor's formatting, block-type, list-wrap and paste tests shrink to one wiring test. Check coverage before cutting.
   - Verify: `npm run test -- src/editor/changeSignals.test.ts`; DocumentEditor pair.

8. **Spike, not a commit**, in a worktree, reported and thrown away. Before commit 10, prove that:
   - text typed at the end edge of a session's own wording gains its mark through `appendTransaction`, and one undo removes a typed run with that mark step;
   - an IME composition inside own wording survives the marker;
   - the guard refuses an edit inside sealed wording, and lets a deletion covering it whole through;
   - the open-box inline decoration and the placeholder widget render with a visible caret;
   - BubbleMenu shows for a collapsed caret.

   Result: all five held, IME included (imitated through Chrome DevTools). What it changed is folded into 9 and 10. The spike's code, screenshots and findings are in the ignored `spikes/wording-mark/`.

9. **Expand: the readers learn the `anchorWording` mark.**
   - The mark: `{ anchorId }`, `inclusive: false`, `clearable: false` as the passage mark has, rendering the `<ins><span>` shape above. It excludes every mark (`_`), itself included. So wording never carries a passage or formatting, bold over it leaves it as it was, and marking typed text strips whatever it inherited.
   - Beside the node:
     - `collectAnchors` reads wording from marked text, trimmed, with blank meaning none;
     - `docToPlainText` skips marked wording;
     - `contentDelta` gains `sameWording`, and `changeSignals`' `is_formatting` uses it in place of the wording meta;
     - `anchorSpans` takes in the wording pieces;
     - `markFrames`' `visibleIn` and `touchedBy` treat marked wording as `'anchor'`.
   - Fixtures and tests:
     - `withAnchorWording` in `anchorFixtures.ts`;
     - mark cases in `anchors`, `entryDocument`, `markFrames` and `documentDiff`;
     - a `changeSignals` case where typing wording isn't formatting.
   - Verify: `npm run test -- src/domain/ src/editor/`. Editor schema, so the full component suites.

10. **Migrate: anchor mode writes wording as text** (Decisions).
    - **The guard** (`editor/anchorGuard.ts`, replacing `isAnchorEdit`), installed in every editor.
      - Always allowed: no steps, an anchor command's meta, and history.
      - In anchor mode, a step is also allowed when it is a text-only replace, with no line break, whose deleted range is empty or lies inside this session's wording. Empty is a bare insertion, which the marker gives a fresh id.
      - In any editor, a step whose result changes sealed wording, its text or its marks, other than removing it whole, is refused. Judged by the step's effect, so bold across it, which the mark's `excludes` makes a no-op there, goes through.
      - In any editor, a step that adds or removes an anchor mark is refused outside an anchor command. `clearable: false` already keeps Clear formatting off them; this is the backstop.
      - Node spec over each case, with ranges built from `anchorSpans`.
    - **Paste:** `transformPasted` strips both anchor marks in every editor, so a copy of anchored text or wording never carries its `anchorId` somewhere new.
    - **Typing** (the `AnchorMode` extension's plugin).
      - `handleTextInput` routes typing on an own passage to the end of its wording, meta-dispatched, as pairing does now.
      - An `appendTransaction` gives text inserted by any other non-meta, non-history transaction exactly one wording mark: the own wording it touches, or the own passage it follows, or else a fresh id.
      - The marker runs during an IME composition too, never deferred to its end. The guard relies on every composed character already carrying the mark; deferred, it refuses each update and leaves stray characters.
      - Known limit: IME inside an own passage, which `handleTextInput` never sees, leaves its first composed character behind.
      - `handlePaste` inserts the clipboard's text as one line.
      - `handleClick` on an own passage or wording moves the caret into its wording. It leaves DocumentEditor.
    - **Decorations:**
      - the open-box class on own wording at the caret;
      - the "Add wording…" widget after an own passage with no wording;
      - `--editable` on all own wording.
      - Padded so the caret draws inside the outline: the spike's caret sat on the box's right border, and just outside the placeholder.
    - **Commands:**
      - `addAnchorMark` marks the passage and puts the caret at its end.
      - `openAnchorWording` becomes `focusAnchor`, which moves the caret to the end of the anchor's wording.
      - `removeAnchor` removes the passage pieces and deletes the wording text.
      - `setAnchorKind` is unchanged.
      - Deleted: `openAnchorInsert`, `updateAnchorInsertText`, `commitAnchorInsert`, `cancelAnchorInsert`, `AnchorInsertStorage`, `openWordingBox`, `ANCHOR_WORDING_TEXT_META`, `readAnchorWordingText`.
      - Announcements are kept for placing, switching kind and removing.
    - **AnchorMenu** gets both states (Decisions), and `Mod-Alt-h/s` switch the kind at the caret.
    - **DocumentEditor** drops `handleTextInput`, `handleClick` and the wording text in `inserted_text` (now read from the steps). It also drops the insert-box CSS, replaced by the decoration classes, and renames the parked CSS's box selector.
    - **Specs:**
      - DocumentEditor's anchor-mode tests type wording into the document; the Escape and Accept cases go.
      - EntryDetailView's component and flow pairs type after Highlight/Strike in place of filling `Wording` and clicking `Accept wording`.
    - Verify: `npm run test -- src/editor/`. Editor schema, so the full component suites.

11. **AnchorMenu pair.**
    - Over a selection: Highlight and Strike.
    - On an own anchor: its kind pressed, Remove, and no kind toggles for a bare insertion.
    - Arrow keys rove, and Tab into the menu keeps it shown.
    - Each button's effect is read off the editor's document.
    - Verify: AnchorMenu pair.

12. **Contract: remove the node.**
    - Code: delete the `AnchorInsert` node, `AnchorInsertView.vue`, `ANCHOR_INSERT_NODE`, every node branch (`INLINE_NODES`, `collectAnchors`, `anchorSpans`, `markFrames`), and the specs' node fixtures (`withAnchorMarkAndWording` builds marks).
    - Types: `anchorModeStorage` reads TipTap 3's augmentable `Storage` interface (`declare module '@tiptap/core'`) in place of its cast.
    - Local data: clear IndexedDB by hand (TESTING.md, "Clearing local data by hand").
    - Docs:
      - ENTRY_MODEL.md: "Related entries and anchors" (wording is marked text), "Two creation experiences" (the guard's ranges).
      - AUTHORING.md: "Signals are outcomes" (a paste into wording is now a paste).
      - PRODUCT.md: §4.4's wording, Escape and controls lines. §5.4's opening, which also gains why the lock exists: to enforce an order of operations (change the anchor from its related entry, then revise the parent) so history only moves forward, not to make removing an anchor hard. §6's parked-presentation line.
      - CHRONICLE_PLAN.md: the anchor wording entry goes. Its "give the walk a way to include wording" moves under search, which has no caller yet.
      - CLAUDE.md: the landmark gains `anchorGuard.ts`.
      - ARCHITECTURE.md: the DocumentEditor box.
      - CODE_REVIEW.md: Track B's file lists (AnchorInsertView gone; EditorToolbar, `useRovingTabindex`, `changeSignals`, `anchorGuard` added).
      - FILE_SPECS.md: its "Editor files wait for Track B" bullet.
    - Verify: full component suites.

13. **Skipped: condense Track B's comments.** Moved to CODE_REVIEW.md's last step, one pass across the repo.

### Track A

14. **Remove the Attachments list.**
    - EntryDetailView drops the section, `mediaEl`, its `useMedia` and the post-flush media watch.
    - PRODUCT.md §4.3's "Attached images appear below the text" becomes "where they were placed".
    - EntryDetailView's "renders an entry's attachments…" becomes DocumentEditor's "shows a stored image in a displayed document".
    - Verify: the EntryDetailView and DocumentEditor pairs.

15. **`describeAnchor` moves to `utils/format.ts`**, beside `entryLabel`.
    - A table in `format.test.ts` covers all eight branches.
    - The page keeps "describes which passage…" as wiring. Check coverage before cutting the orphan test, which also proves the italic.
    - Verify: `npm run test -- src/utils/format.test.ts`; EntryDetailView pair.

16. **`entriesStore`: one fold for a timeline root, and no second empty check.**
    - An `aggregateRoot(root)` above the store reads the root's revisions and folds them, for `aggregateRoots` and `refreshRoot`. `addRoot` uses it too, at the cost of one empty `listRevisions`.
    - `requireContent` goes: `sealDraft` throws the same error before its only caller, `inputsForDraft`, and the timeline `error` it cleared has nothing to do with a seal. Its `entriesStore.test.ts` case goes, since `draftsStore.test.ts` proves the refusal. Comments citing it (`canSave`, `fieldsFromDraft`, `parseDocument`) cite `sealDraft`.
    - Verify: `npm run test -- src/stores/`. A store change, so the full component suites.

17. **Remove entry points nothing in the app calls** (TESTING.md: "source carries no entry points of its own for tests").
    - `useMedia` returns `{ store, applyTo }`. Its pair goes through `applyTo`, fetching the `src` it set, and stopping the scope revokes it.
    - `InMemoryEntryRepository.clear()` and `InMemoryMediaRepository.clear()` have no callers.
    - Verify: useMedia pair; `npm run test -- src/repositories/`.

18. **Declare the Dexie schema once,** at version 5, with all four tables. Its comment says why there's no history (CLAUDE.md).
    - Verify: the `dexie*.browser.test.ts` specs. Every browser spec opens this database, so the full component suites.

19. **The adapters lose their test-only API.**
    - CODE_REVIEW.md's A10 note covers `dispose()`. Beyond it, `close()`, the `ChronicleDatabase | string` constructors and `resolveDatabase` serve only the adapter specs.
    - The contract specs build through `realRepositories.ts`'s `fresh*Repository()`, which gains removing an OPFS directory by name.
    - The reload specs open and close a `ChronicleDatabase` themselves.
    - The A10 note leaves CODE_REVIEW.md.
    - Verify: shared test setup, so the full component suites.

20. **Skipped: condense Track A's comments.** Moved to CODE_REVIEW.md's last step, as 13 was.

## Left out, and why

- **PRODUCT.md §5.4 and item 3:** see Decisions.
- **Item 2's ground:**
  - `sameVersion`'s hand-kept field list;
  - `relationTypeForAnchors`;
  - the breadcrumbs;
  - `listConnectionsFor`;
  - `listChildren`, which only specs call, but whose lookups item 2 reshapes.
- **Read-side code with no caller yet,** built ahead for PRODUCT.md §5.1–5.2: `buildEntryHistory`, `documentsFromFrames`, `diffDocuments`, `markSetsStore`. Likewise `MediaRepository.delete` and `list`, which an import queue would read (ENTRY_MODEL.md, "Imports").
- **FILE_SPECS.md's ground:** `useLayoutWidth`'s fallback, EntryList's `emptyMessage`, TimelineView's unhandled rejection.
- **CODE_REVIEW.md's A6 and B4 notes.** These are draftsStore's and the recorder's units, both already reviewed. B4's call (whether `AuthoringChange` requires its signals) can be made when commit 3 is in `traceRecorder.ts`.

## Manual check

`npm run drive` (the run-app skill), in one flow:

- **New entry.** Type a title, Tab onto the toolbar, arrow within it, Tab into the body, type, bold a word, and add a link. Open More and Escape out of it, then attach an image through More → Add image. Press Bookmark: "Bookmarked at …" shows. Reload: the draft resumes with its title and formatting. Save.
- **Related entry, on that entry.**
  1. Highlight a passage. The caret waits beside an "Add wording…" placeholder. Type wording, Backspace a letter, and undo.
  2. Click elsewhere, then click the wording: the caret returns and the menu offers Highlight/Strike/Remove. Switch it to Strike with Ctrl+Alt+S.
  3. Type at a bare caret elsewhere for a second anchor.
  4. Save. The parent shows both anchors, with italic wording, and the related entry's card describes each.
- **Revise the parent.** Typing inside the wording does nothing. Deleting a range that covers it whole goes through, and the revision warns, naming the related entry.
