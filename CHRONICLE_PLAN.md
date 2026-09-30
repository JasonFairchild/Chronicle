# Chronicle — Plan

What comes next, and the engineering work that is decided but not built. What decided features do
for the user is [PRODUCT.md](./PRODUCT.md) §5; this doc holds the order and the technical side.

## Priorities

In order. Reorder here as priorities shift.

1. **Test overhaul on Drafts** — contract, store, Dexie, browser, and Cypress — with the lessons
   recorded in TESTING.md and applied to later tests. Working plan:
   [TEST_OVERHAUL.md](./TEST_OVERHAUL.md).
2. **Session tracking as a ProseMirror plugin** (below).
3. **Anchor wording as marked text** (below). Likely done together with 2, and before 5, since seed
   traces record whichever document shape exists.
4. **Validating content against the schema before it's stored** (below).
5. **Seed data carrying a real authoring trace**, so the history view has long, replayable sessions
   to be designed against.
6. **The scrubbable history view** (PRODUCT.md §5.1). Paint each frame with a read-only editor view
   and a `DecorationSet` built from its `FrameChange` ranges: no injected marks, no hand-built HTML.

Further out, with no order yet: everything else in PRODUCT.md §5.

## Decided engineering work

- **Session tracking as a ProseMirror plugin.** `DocumentEditor`'s `onUpdate` merges
  `[transaction, ...appendedTransactions]` by hand and keeps `liveAnchorSpans`, `affectedAnchorIds`
  and `heldSteps` as component variables. A plugin's `state.apply` sees every transaction, appended
  ones included, with `tr.mapping` in hand; it is testable in node against a bare `EditorState`, and
  can feed decorations if a disturbed anchor should show in the editor.
- **Anchor wording as marked text.** Wording sits in the parent's anchor revision as an atom
  `anchorInsert` whose `text` attribute an `<input>` rewrites whole on each keystroke, so its events
  record no deletions, report the box's entire contents as `inserted_text`, miss paste, and give the
  history view only whole-wording frames. As ordinary text carrying an `anchorWording` mark, it gets
  every signal, per-keystroke undo, and character-level frames like prose, and the `<input>`, its
  commit/cancel state and `ANCHOR_WORDING_TEXT_META` go away. The mark renders the same `<ins>`;
  while the caret is in this session's wording, a decoration draws it as the box, and a placeholder
  widget stands in for an empty one. The cost is the guard: in anchor mode, allow only steps inside
  or at the edge of this session's wording (no formatting, no Enter, since wording is single-line
  plain text); in every editor, reject steps touching sealed wording. PRODUCT.md §5.4 later extends
  that to the text under any anchor, so build the guard to take a set of locked ranges. The
  flattening then skips wording by filtering on the mark, not because the text sits in an attribute,
  which turns the exclusion into a choice each reader makes: anchors, diffs, previews and the check
  that an anchor revision leaves the parent's text unchanged keep skipping it, but search shouldn't
  be locked out. Give the walk a way to include wording, so search can find words a related entry
  proposed and attribute them to that entry.
- **Validating content against the schema before it's stored.** `parseDocument` checks only
  `type === 'doc'`, and rows are immutable, so a malformed document would be permanent. Editor
  content is valid by construction; seeding, import, and sync won't be. The check is
  `schema.nodeFromJSON(json).check()`. Open question: where it lives, since the domain deliberately
  doesn't import the editor's schema — the store layer, or a validator injected into it.
  The same concern covers traces: nothing checks at runtime that a replay reproduces the entry's
  `content`. A step that fails ends a mark set early, and a missed step can replay silently to the
  wrong document. A built set should compare its last document to `content` and record whether it
  is complete.
- **A unified entry editor.** Every composer (a new entry, a revision, a related entry, a
  connection) shows every versioned field a writer sets: title, dates and their notes, location,
  original medium. Today each shows a different subset, and revising shows no dates. Drafts already
  carry every field, so this is UI. A shared shell is the likely form; the
  primary and secondary button classes already repeat across the composers.
- **SQLite WASM + OPFS** is the preferred long-term backend, deferred until the Dexie path has been
  used in anger. The composition root (`src/repositories/index.ts`) makes it a one-line swap. It
  doesn't change durability: OPFS is the same site storage as IndexedDB, evicted and cleared by the
  same rules, so persistent storage and backup answer data loss, not the engine.
- **A revision's diff from its frames** (PRODUCT.md §5.2). Treat a whole session as one frame of
  the mark-set builder; `diffDocuments` (no production caller yet) is then only for a revision with
  no trace.

## Engineering maybes

Not decided; one line each so they're not lost.

- **Automatic backup to a folder the writer picks** (File System Access; Chromium desktop only), so
  clearing the browser can't take the only copy, and a synced folder gives an off-device one without
  Chronicle touching a network. Incremental by nature, since entries never change. Elsewhere it
  falls back to a downloaded file. Pairs with PRODUCT.md §5.8's export.
- **A desktop shell** (Tauri, say) holding the SQLite database as an ordinary file, beside the PWA
  rather than replacing it.
- **A schema version on drafts and traces**, once real data must survive a schema change, so a
  resume or a replay knows its steps are old rather than failing on them.
- **Rebasing a stale draft** instead of refusing its save: map its steps through the intervening
  revision's, as ProseMirror's collab rebase does. The draft keeps its base version and content for
  this.
- **A related entry's own anchors as the one concept for what a session may touch.** Half-explored.
  Today it is "not in the base" (`sealedAnchorIds`, `anchorsPlacedSince`), and PRODUCT.md §5.4 adds
  "minus the related entry's own". One rule could cover both: the entry's saved `anchors` plus those placed
  since the base, filtered to what's present at seal (an append-only list needs no undo tracking).
  The same list feeds numbering and grouping by related entry (PRODUCT.md §5.4, §6). Revisit after
  anchor wording as marked text and §5.4, which remove most of `anchorCommands.ts` anyway.
- **`contentDelta` walks the whole document several times per keystroke**
  (`DocumentEditor.vue`'s `onUpdate`). Fine today.
