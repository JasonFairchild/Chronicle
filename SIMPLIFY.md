# Simplify Track B, wording as marked text, and Track A's unreviewed files

Status: commits 0–9 and 14–16 done. 17 is built and verified; committing it is next.

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

- **PRODUCT.md §5.4's lock is in this plan (commit 9); Revise on a related entry is not.** Decided 2026-11-03, reversing the first call to leave all of §5.4 out.
  - **What the lock is for:** it enforces an order of operations. Remove or reshape an anchor from the related entry first, then revise the parent, so history only moves forward.
  - **Why Revise waits:** it shares two foundations with item 2:
    - versioned relation state: a related entry's anchors, and item 2's targets, become part of its version, with annotation/update derived from the current one;
    - a draft whose anchor-revised documents are a list keyed by entry: today's parent, §5.4's parent, a connection's targets.

    So item 2 is planned starting from those two foundations, and Revise on a related entry follows it.

  - **Why the lock doesn't:** it was held back because, until Revise exists, it makes the order impossible rather than enforced: a saved anchor can't be removed at all, and the text under it can't change. Nobody uses the app yet, so that interim costs nothing, and it lets the warning go now rather than be rebuilt in step C's editor.

- **Item 3 is not built, and the warning it served goes.** Its main job, tracking which anchors a revision disturbed, is the warning the lock replaces. Once the guard refuses every change to a sealed anchor, the warning can never fire, so it fails CLAUDE.md's remove-the-line check (step C). Held scaffolding steps stay in `onUpdate`, which becomes simpler once the title leaves it.
- **Wording is typed into the document: there is no `<input>`, and no box state.** Today's flow becomes:
  1. Select a passage and press Highlight or Strike. The caret lands right after the passage, beside a small outlined box with a greyed "Add wording…" placeholder, much as today's box looks. The box and placeholder are decorations drawn around the document's own text, not a separate field.
  2. Type. The letters go into the document there, underlined and anchor-colored inside the outline. Backspace, undo and paste work as in prose; a paste now counts as a paste.
  3. Move on: click elsewhere, or arrow out. The outline goes, and the wording stays inline after its passage. There's no Accept step; Enter and Escape do nothing there, and undo replaces Escape-restore.
  4. Come back: click the passage, and the caret goes to the end of the wording; click the wording, and it lands where clicked. The outline reappears, and AnchorMenu offers Highlight/Strike/Remove.

  To propose wording with no passage, place the caret anywhere and type, as now. Screen readers hear the wording as part of the document, and the live region still announces placing, switching and removing.

- **The title is a plain field per version, with no steps and no writing history.** ENTRY_MODEL.md already says this: edited in an `<input>`, "absent from the authoring trace", "folded through the version chain like the dates". The draft holds its latest value, and sealing copies it, whole, into the new version. Commit 3 makes the code match. Today each title keystroke travels as a step-less document change, and after commit 3 it goes straight into the draft's fields.
- **A Bookmark button in EntryComposer** (commit 5). `draftsStore.addMark`, the trace's `manual` event and `deriveMarks`' top-priority `manual` reason are all built, but nothing in the UI calls them. A bookmark shows nowhere until the history view (§5.1), but it's recorded from now on.
  - It sits on the draft's "Saved as a draft" line, not in the toolbar: it acts on the draft's trace, not the document, and the toolbar's every action is a command on its editor. In the toolbar, DocumentEditor would relay something that isn't its document, which is what commit 3 takes the title out of.
  - Rejected: a marker in the text, since a bookmark is a moment of the whole document rather than a place in it, and a position would vanish on reload unless `ManualEvent` stored one.
- **AnchorMenu is the one control surface.** Over a selection it offers Highlight and Strike, as now. With the caret on an anchor this session placed, it offers Highlight/Strike pressed for that anchor's kind (absent for a bare insertion), plus Remove. Ctrl+Alt+H/S switch the kind from the caret.
- **A sealed anchor is locked in every editor:** its passage and its wording, their text and their formatting, inline (bold) or block (a heading or list over its paragraph). Deleting it whole is refused too. Typing against its outer edges is fine. In a revision every anchor is sealed; in anchor mode, every anchor in the session's base. Refused edits do nothing, with no message for now (PRODUCT.md §5.4 has the open question).
- **The interlinear presentation stays parked.** The wording mark renders the same `<ins class="chronicle-anchor-insert"><span class="chronicle-anchor-wording">` shape, so the parked CSS keeps applying. Only its `.chronicle-anchor-insert-box` selector becomes the open-wording decoration's class. If it's ever revived, wording would show raised only while the caret is elsewhere, since typing into absolutely positioned text is unreliable.
- **Item 4 is two commits, built in steps** (commit 9). Each step is green and reviewed before the next. Inside it, expand, migrate, contract keeps each step green: the readers learn the mark beside the node, the editor writes the mark, and the node goes. 9a (steps A–C) ends with the editor writing the mark, and its docs describe that. 9b (D–F) removes the node, adds Undo and Redo to anchor mode, and reads wording as the parent's text.
  - Split 2026-11-04, after C. One commit was chosen so its diff showed the node going out beside the mark coming in, but by C it was too large to review well. C leaves a consistent state: nothing writes the node, and the readers handle it, inert.
  - Rejected: a commit per step, which this plan first chose to keep each diff small.
  - The dual reading protects no stored data: old local data with `anchorInsert` nodes is cleared, not tolerated (CLAUDE.md). Its only job was a smaller diff.
  - `AnchorInsertView.vue` calls the box's commands, so it can't outlive the step that deletes them.
  - AnchorMenu's new states would ship untested for a commit.
- **Wording is part of the parent's text** (commit 9, step F). Wording a related entry proposes belongs to the parent as much as its author's own words, so previews, the empty check, and later search and diff read it, and `docToPlainText` stops skipping it.
  - The page sets wording flush against the text around it, with no margin, so spacing is the author's alone and an insertion mid-word reads as one word. A struck "rained" takes the wording " poured", its space typed, to read "rained poured" on the page and in the flattening alike. The flattening adds nothing around wording.
  - Struck text stays in the plain text, which can't show a strike: that preview reads "rained poured".
  - Wording is stored and read as typed, spaces included: they're the author's spacing, as in prose, and a bare insertion of one space ("wentalone") is a real correction. Rejected: trimming `insertion`, which made that correction read as an annotation. A card quoting wording shows its spaces. `previewText` still collapses whitespace, since a one-line summary has to; formatted previews (CHRONICLE_PLAN.md) would render spaces through the document CSS.
  - It stays marked: the wording mark is stored in every version, so wording always reads as its related entry's, and the lock keeps a parent revision off it.
  - "No related entry is destructive" still holds, restated: a related entry marks passages and adds wording, and never changes or removes the parent's own words. The guard enforces it. Nothing in the app compares the parent's text before and after, so `sameContent`, which only its spec calls, goes. So do `sameWording` and `wordingKey`, since `sameText` now sees typing in wording.

- **The guard judges outcomes against a snapshot** (`editor/anchorGuard.ts`), pure and node-tested on a bare `EditorState`. When the editor opens, `sealAnchors` records each sealed anchor by id as a slice from its first piece to its last, with the blocks around it: a revision seals the document it opens with, anchor mode its base. A change is refused unless each is still there, exactly. Only anchor mode's typing rule reads steps, since the guard runs before the marker and freshly typed text isn't wording yet. CLAUDE.md's landmark "schema and the guarded, anchor-aware document commands live only in `extensions.ts` and `anchorCommands.ts`" gains `anchorGuard.ts`.
  - It relies on an editor never being handed a new document in place: both composers key DocumentEditor on `session.editorKey`, so a new document is a new editor and a new snapshot. A `setContent` on a live editor would read as every sealed anchor deleted.
  - It judges what a change did, not the cursor or selection: Backspace just after a passage deletes inside it with the caret outside, and drop, paste, undo and IME change text away from the selection. Saying why an edit did nothing (a hover message, say) is UI, reading the selection, and comes later. It isn't disabling: CLAUDE.md keeps controls enabled and says why.
  - One walk of the document per change, none when nothing is sealed. The editor already walks the whole document about ten times per change (`contentDelta`, `onUpdate`). If the guard ever shows in a profile, a `DecorationSet` can locate the anchors without walking (CHRONICLE_PLAN.md, "Engineering maybes").
  - Rejected:
    - Judging each step's positions against anchor ranges, built first. It had to settle which steps have a range, whether an edge is inside, how an anchor's pieces join, and the document each step saw, at twice the code, and still mispredicted a step that changes nothing.
    - Comparing before and after each transaction: a walk of both documents, where the sealed side never changes.
    - Sealed anchors as uneditable islands in the editor (an atom node, `contenteditable=false`): the trace records the editor's steps against the stored document, so its shape can't differ, and a deletion across an island still needs a guard.
    - Refusing a new anchor mark outside an anchor command: nothing produces one once paste strips them (step C).
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
- 8 is the spike. 9 is item 4, in two commits (9a, 9b), after 7, with 10–12 folded into it.
- 13 and 20 are skipped.
- 14–19 are independent.
- FILE_SPECS.md commit 2 (the `useDraftSession` spec) comes after commits 3 and 5 here, and covers `handleFieldsChange` and `bookmark`.
- Commits here and in FILE_SPECS.md that touch EntryDetailView's pairs rebase on whichever lands first.
- Last, once the rest are in: delete this file, and every citation of it in CHRONICLE_PLAN.md, CODE_REVIEW.md and FILE_SPECS.md.

0. **Check the plan in and set the order.**
   - Write this plan to `SIMPLIFY.md` at the repo root, beside CODE_REVIEW.md and FILE_SPECS.md, and keep its Status current from then on. Code comments never cite it (CLAUDE.md).
   - CHRONICLE_PLAN.md:
     - Priority 1 (Review) gains this plan as the source simplification it front-loads, with anchor wording done inside it. That item leaves the numbered list; its "Decided engineering work" entry points here until commit 9 removes it, and this plan wins where the two differ.
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
   - The wording-box meta stays until commit 9's step C.
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

8. **Spike, not a commit**, in a worktree, reported and thrown away. Before the editor writes the mark (commit 9, step C), prove that:
   - text typed at the end edge of a session's own wording gains its mark through `appendTransaction`, and one undo removes a typed run with that mark step;
   - an IME composition inside own wording survives the marker;
   - the guard refuses an edit inside sealed wording, and lets a deletion covering it whole through;
   - the open-box inline decoration and the placeholder widget render with a visible caret;
   - BubbleMenu shows for a collapsed caret.

   Result: all five held, IME included (imitated through Chrome DevTools). What it changed is folded into commit 9's steps A and C. The spike's code, screenshots and findings are in the ignored `spikes/wording-mark/`.

9. **Anchor wording as marked text: two commits, in steps** (Decisions). 9a is steps A–C and its docs; 9b is steps D–F and the rest. Each step passes `npm run typecheck` and the specs it names, and is reviewed before the next begins. The full component suites run before each commit.
   - **A. The readers learn the `anchorWording` mark.** Done.
     - The mark: `{ anchorId }`, `inclusive: false`, `clearable: false` as the passage mark has, rendering the `<ins><span>` shape above. It excludes every mark (`_`), itself included. So wording never carries a passage or formatting, bold over it leaves it as it was, and marking typed text strips whatever it inherited.
     - Beside the node:
       - `collectAnchors` reads wording from marked text as written, spaces included (Decisions);
       - `docToPlainText` skips marked wording;
       - `contentDelta` gains `sameWording`, and `changeSignals`' `is_formatting` uses it in place of the wording meta;
       - `anchorSpans` takes in the wording pieces;
       - `markFrames`' `visibleIn` and `touchedBy` treat marked wording as `'anchor'`.
     - Fixtures and tests:
       - `withAnchorWording` in `anchorFixtures.ts`;
       - mark cases in `anchors`, `entryDocument`, `markFrames` and `documentDiff`;
       - a `changeSignals` case where typing wording isn't formatting.
     - Verify: `npm run test -- src/domain/ src/editor/`.
   - **B. The guard, alone** (`editor/anchorGuard.ts`). Done. Not installed until step C: it lets an insertion at a bare caret through for the marker to mark, so without the marker a paste there would land as the parent's own text.
     - `allowsEdit(transaction, sealed, anchorMode)`, with `sealed` from `sealAnchors` (Decisions).
     - Always allowed: a change to the selection alone, an anchor command's meta, and history.
     - In any editor, refused unless every sealed anchor is as `sealed` holds it: its text, its marks and the blocks around it. Text typed against an outer edge isn't marked, so it lands outside.
     - In anchor mode, also refused unless every step inserts bare text and deletes only wording. Sealed wording is already kept by the lock, so that's the session's own. An insertion anywhere else is a bare insertion, which the marker gives a fresh id. Bare text rules out a paragraph split, a hard break and an image.
     - `ANCHOR_EDIT_META` is exported from `anchorCommands.ts`, which the guard imports `anchorSpans` from. Undo and redo are recognised by prosemirror-history's `isHistoryTransaction`.
     - Node spec over each case, as tables where cases differ only in positions or a mark. It also covers `anchorSpans`' wording branch. Without a unit test, to be covered in step C: the mark's `excludes` (the marker strips inherited marks), and `clearable` (EditorToolbar's pair), which needs a TipTap `Editor`.
     - Verify: `npm run test -- src/editor/anchorGuard.test.ts`.
   - **C. Anchor mode writes wording as text** (Decisions). Done. The guard goes into every editor in place of `isAnchorEdit`, with the marker it relies on.
     - **Installing the guard:** one plugin in every editor, its state the snapshot: `sealAnchors` of the opening document in a revision, of the base in anchor mode. The snapshot replaces AnchorMode's `sealedAnchorIds`: `isEditableAnchor`, `sealedAnchorIdsOf` and `editableAnchorRanges` read its keys.
     - **Paste:** `transformPasted` strips both anchor marks in every editor, so a copy of anchored text or wording never carries its `anchorId` somewhere new. It's the only thing that does: the guard doesn't refuse a new anchor (Decisions).
     - **Typing** (the `AnchorMode` extension's plugin).
       - `handleTextInput` routes typing on an own passage to the end of its wording, meta-dispatched, as pairing does now.
       - An `appendTransaction` gives text inserted by any other non-meta, non-history transaction exactly one wording mark: the own wording it touches, or the own passage it follows, or else a fresh id.
       - The marker runs during an IME composition too, never deferred to its end. The guard relies on every composed character already carrying the mark; deferred, it refuses each update and leaves stray characters.
       - Known limit: IME inside an own passage, which `handleTextInput` never sees, leaves its first composed character behind.
       - `handlePaste` inserts the clipboard's text as one line.
       - `handleClick` on an own passage moves the caret to the end of its wording; on wording, it leaves the caret where the click put it. It leaves DocumentEditor.
     - **Decorations:**
       - the open-box class on own wording at the caret;
       - the "Add wording…" widget after an own passage with no wording;
       - `--editable` on all own wording.
       - The caret draws where ProseMirror puts it, at the box's edge rather than inside: moving it would mean fighting the editor's own caret placement, for looks alone. The open box is padded on its end side only, so the text before it doesn't shift as it appears; the placeholder, holding no text, is padded.
     - **Commands:**
       - `addAnchorMark` marks the passage and puts the caret at its end.
       - `openAnchorWording` becomes `focusAnchor`, which moves the caret to the end of the anchor's wording.
       - `removeAnchor` removes the passage pieces and deletes the wording text.
       - `setAnchorKind` is unchanged.
       - Deleted: `openAnchorInsert`, `updateAnchorInsertText`, `commitAnchorInsert`, `cancelAnchorInsert`, `AnchorInsertStorage`, `openWordingBox`, `ANCHOR_WORDING_TEXT_META`, `readAnchorWordingText`.
       - Announcements are kept for placing, switching kind and removing.
     - **AnchorMenu** gets both states (Decisions), and `Mod-Alt-h/s` switch the kind at the caret.
     - **DocumentEditor** drops `handleTextInput`, `handleClick` and the wording text in `inserted_text` (now read from the steps). It also drops the insert-box CSS, replaced by the decoration classes, and renames the parked CSS's box selector.
     - **`AnchorInsertView.vue` goes here**, with the node's `addNodeView` and `addStorage`, since it calls the deleted commands. Until step D the node renders through its `renderHTML`.
     - **The affected-anchor warning goes** (Decisions), since the guard now refuses everything it warned about: DocumentEditor's `affectedAnchorIds` and the `EditorChange` field, `mapAnchorSpans` and `MappedAnchorSpan`, EntryDetailView's `revisionAffectedAnchorIds`, `revisionWarnings`, `trackAffectedAnchors` and the warning's template, and `anchorWarnings.ts` with its spec. `anchorSpans` keeps the guard and whichever other callers this step leaves.
     - **Specs:**
       - DocumentEditor's anchor-mode tests type wording into the document; the Escape and Accept cases go.
       - EntryDetailView's component and flow pairs type after Highlight/Strike in place of filling `Wording` and clicking `Accept wording`.
       - EditorToolbar's Clear formatting case gains wording, which keeps its mark (`clearable: false`).
       - EntryDetailView's two warning tests ("warns before saving…", "warns when a paste swaps…") become one: a revision can't change the text under an anchor, and saving shows no warning. Its orphan test stays: seeded data can still orphan an anchor.
       - DocumentEditor's pair: one wiring test that a revision's guard refuses typing inside an anchor.
       - A new AnchorMenu pair:
         - over a selection, Highlight and Strike;
         - on an own anchor, its kind pressed, Remove, and no kind toggles for a bare insertion;
         - arrow keys rove, and Tab into the menu keeps it shown;
         - each button's effect is read off the editor's document.
     - Verify: `npm run test -- src/editor/`; the DocumentEditor, AnchorMenu and EntryDetailView pairs.
   - **9a's docs**, for what A–C built. Done.
     - ENTRY_MODEL.md: "Related entries and anchors" (wording is marked text), "Two creation experiences" (the guard and its snapshot, with the marker it relies on, now the one enforcement, and the lock in every editor). "Warning on an affected anchor" goes. "Considered and rejected" gains wording stored on the related entry, wording as an atom node, and the guard's rejected designs (Decisions).
     - AUTHORING.md: "Signals are outcomes" (a paste into wording is a paste).
     - PRODUCT.md: §4.4's wording, Escape and controls lines. §4.5's warning becomes the lock, moved from §5.4 with its interim and its open question. §6's raised-wording line.
     - CHRONICLE_PLAN.md: "TESTING.md's rules beyond drafts"' anchor-warning case goes. The "A related entry's own anchors" maybe reads the guard's snapshot in place of `sealedAnchorIds`.
     - CODE_REVIEW.md: Track B's file lists (AnchorInsertView and `anchorWarnings` gone; EditorToolbar, `useRovingTabindex`, `changeSignals`, `anchorGuard` added), and its manual check's warning.
     - CLAUDE.md: the editor landmark gains `anchorGuard.ts`.
     - ARCHITECTURE.md: the DocumentEditor box.
     - FILE_SPECS.md: its "Editor files wait for Track B" bullet.
   - Verify 9a, before committing: the full component suites, and `npx prettier --check` on the docs.

   - **D. Remove the node.** Done.
     - Code: delete the `AnchorInsert` node, `ANCHOR_INSERT_NODE`, every node branch (`INLINE_NODES`, `wordingAnchorId`, `anchorWording`, `collectAnchors` and its `|| null`, which only the node's empty text needed, `anchorSpans`, `markFrames`), and the specs' node fixtures.
     - `findAnchor` goes, and with it a `toJSON` and `collectAnchors` over the whole document to read one anchor: `setAnchorKind` and `ownAnchorAt` read `kind` from the passage mark, and `removeAnchor` describes the anchor from the pieces it already finds.
     - Local data: clear IndexedDB by hand (TESTING.md, "Clearing local data by hand").
     - Verify: `npm run test -- src/domain/ src/editor/`.
   - **E. Undo and Redo in anchor mode.** Done. Ctrl+Z works there, but the buttons went with the formatting toolbar.
     - Where text mode has them, at the top left above the document. Not in AnchorMenu: it shows only over a selection or the session's own anchor, so it's gone just after Remove or a click away, when undo is most wanted.
     - EditorToolbar gains a `historyOnly` prop that renders its history group alone; DocumentEditor shows the toolbar in anchor mode with it set. There its name is "… toolbar", since "… formatting" would be wrong. Undo already passes the guard (`isHistoryTransaction`), so the buttons run what Ctrl+Z does.
     - Specs: EditorToolbar's pair, that history-only shows Undo and Redo and nothing else; DocumentEditor's pair, that Undo in anchor mode takes back a placed anchor. No spec Tabs through an anchor-mode page, so none changes order.
     - Verify: `npm run typecheck`; the EditorToolbar and DocumentEditor pairs.
   - **F. Wording reads as the parent's text** (Decisions). Done.
     - `docToPlainText` stops skipping wording, and adds nothing around it: the author types any space wording needs (Decisions).
     - `sameContent`, `sameWording` and `wordingKey` go, with their cases.
     - That leaves `collectAnchors` as `anchorWording`'s only caller, so it folds into that walk: a wording piece adds to its anchor's `insertion` as a passage piece adds to its `quote`.
     - `sameText` drops only trailing line breaks, the editor's scaffolding it exists to ignore, rather than all whitespace. That keeps what `sameWording`'s untrimmed comparison gave: a space typed at the end of the document is typing, in wording or prose.
     - Specs that assert an anchor session leaves `docToPlainText` unchanged now expect the wording in it: DocumentEditor's pair and EntryDetailView's flow pair.
     - Verify: `npm run test -- src/domain/ src/editor/`; the DocumentEditor and EntryDetailView flow pairs.
   - **9b's docs**, after D, E and F. Done.
     - ENTRY_MODEL.md: "Two invariants" (restated as in Decisions), and "Related entries and anchors"' skip becomes wording read as the parent's own.
     - AUTHORING.md: "Mark sets" names `docToPlainText` the ruler "anchors, search and diff use"; anchors leave that list.
     - PRODUCT.md: §4.4 gains Undo and Redo, and that an entry's preview includes its wording. §5.4's opening cites the anchor wording entry, which goes.
     - CHRONICLE_PLAN.md: the anchor wording entry goes.
     - CLAUDE.md: the `entryDocument.ts` landmark goes: its reason, a ruler anchors measure on, went with offset anchors, and its one rule, skipping wording, goes in step F.
     - Comments citing the skip or the ruler: `entryDocument.ts`'s header and `ANCHOR_WORDING_MARK`, and `documentDiff.ts`'s header.
     - CODE_REVIEW.md: drop the units' line counts, which go stale with every commit.
   - Verify 9b, before committing: the full component suites, and `npx prettier --check` on the docs.

10. **Folded into 9.**

11. **Folded into 9.**

12. **Folded into 9.**

13. **Skipped: condense Track B's comments.** Moved to CODE_REVIEW.md's last step, one pass across the repo.

### Track A

14. **Remove the Attachments list.**
    - EntryDetailView drops the section, `mediaEl`, its `useMedia` and the post-flush media watch.
    - PRODUCT.md §4.3's "Attached images appear below the text" becomes "where they were placed".
    - EntryDetailView's "renders an entry's attachments…" becomes DocumentEditor's "shows a stored image in a displayed document".
    - Verify: the EntryDetailView and DocumentEditor pairs.

15. **`describeAnchor` moves to `utils/format.ts`**, beside `entryLabel`, for a unit-test seam rather than a second caller.
    - Its "point in the text" branches go: they served the removed node's empty wording, and a kind now always comes with a passage.
    - A table in `format.test.ts` covers the seven that are left, orphans included until item 2 removes them.
    - The page keeps "describes which passage…" as wiring. The orphan test goes from the pair: what only it proved, anchors read from the version being viewed, moves to `reconstructEntryState.test.ts`. The flow specs' comments stop citing `describeAnchor`.
    - Verify: `npm run test -- src/utils/format.test.ts src/domain/reconstructEntryState.test.ts`; EntryDetailView pair and flow pair.

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

- **Revise on a related entry (PRODUCT.md §5.4) and item 3:** see Decisions.
- **The saved quote and orphaned anchors.** With the lock, nothing in the app removes a sealed anchor except Revise on its related entry, which drops the ref with it, so `AnchorRef.quote` and `resolveAnchors`' `orphaned` branch serve only seeded data. They go with item 2, which reshapes a related entry's anchors into versioned relation state, rather than reshaping `AnchorRef` twice.
- **Item 2's ground:**
  - `sameVersion`'s hand-kept field list;
  - `relationTypeForAnchors`;
  - the breadcrumbs;
  - `listConnectionsFor`;
  - `listChildren`, which only specs call, but whose lookups item 2 reshapes.
- **Read-side code with no caller yet,** built ahead for PRODUCT.md §5.1–5.2: `buildEntryHistory`, `documentsFromFrames`, `diffDocuments`, `markSetsStore`. And `documentsAt`, for §6's keystroke zoom. Likewise `MediaRepository.delete` and `list`, which an import queue would read (ENTRY_MODEL.md, "Imports").
- **FILE_SPECS.md's ground:** `useLayoutWidth`'s fallback, EntryList's `emptyMessage`, TimelineView's unhandled rejection.
- **CODE_REVIEW.md's A6 and B4 notes.** These are draftsStore's and the recorder's units, both already reviewed. B4's call (whether `AuthoringChange` requires its signals) can be made when commit 3 is in `traceRecorder.ts`.

## Manual check

`npm run drive` (the run-app skill), in one flow:

- **New entry.** Type a title, Tab onto the toolbar, arrow within it, Tab into the body, type, bold a word, and add a link. Open More and Escape out of it, then attach an image through More → Add image. Press Bookmark: "Bookmarked at …" shows. Reload: the draft resumes with its title and formatting. Save.
- **Related entry, on that entry.**
  1. Highlight a passage. The caret waits beside an "Add wording…" placeholder. Type wording, Backspace a letter, and undo.
  2. Click elsewhere, then click the wording: the caret returns and the menu offers Highlight/Strike/Remove. Switch it to Strike with Ctrl+Alt+S.
  3. Type at a bare caret elsewhere for a second anchor.
  4. Save. The parent shows both anchors, with underlined wording, and the related entry's card describes each. The parent's card on the timeline previews its text with the wording in it.
- **Revise the parent.** Typing inside a passage or its wording, deleting a range that covers an anchor whole, and bolding across one all do nothing. Typing right after the wording works. Saving shows no warning.
