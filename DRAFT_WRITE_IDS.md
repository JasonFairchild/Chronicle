# A tab writes only over the draft it has seen

Status: commit 0 lands with this file. The working tree also holds AUTHORING.md's new "Draft safety" section and two citation fixes (`App.vue`, `draftRepository.contract.ts`), which commit 1 takes. This file is deleted when commit 1 lands, once anything that outlasts it is in the docs.

## Context

A draft open in two tabs relies on two guards: event rows are added, never put, so two tabs can't append at one index; and a tab being returned to reloads what another wrote. Neither stops a write that appends no events, or one from a tab whose return check ran before the other tab's write landed. Two windows side by side make that easy: both stay visible, so leaving one doesn't flush it, and its 300 ms flush can land after the other window has already checked. Found so far, each silent:

1. A title- or dates-only save from a stale tab replaces the snapshot, so the other tab's words leave it, while the event log still replays to them.
2. A save after the draft was sealed or discarded elsewhere recreates the row, holding only the tail of a log.
3. Emptying a stale tab's copy deletes the row, and the other tab's words and events with it.
4. Sealing from a stale tab writes its older text as the entry and removes the newer draft.
5. A stale discard, or `releaseIfEmpty` reading the row then deleting it in a second transaction, removes words written in between.

One rule closes all of them: **every write to a draft row names the write it follows, and is refused if disk holds a different one.**

## Decisions

- **A write id, not `updated_at`, is the version.** Each flush stamps the row with a fresh `newId()` (UUIDv7, as session ids already are). Reviewed against the smaller alternative — `updated_at` as the version, with `addMark` made to restamp it — and kept, for two reasons:
  - _Tests write faster than a person._ With in-memory adapters, two tabs' writes routinely land in one millisecond; under fake timers every stamp is identical. A millisecond version would let a stale write through there, so the hole tests could pass or fail by timing, and every multi-tab test would need to step the clock (one already does, in `draftsStore.test.ts`). A random id has no tie to fall into.
  - _One stamping site._ `updated_at` is stamped at each change site (`replaceSnapshot`, `startingSnapshot`), and `addMark` already misses it. A write id is stamped where the write is made, so no future change path can forget it.
  - _The cost:_ one field on `DraftOf`, its fixtures, and AUTHORING.md's code block. `updated_at` keeps one job: ordering and showing the drafts list.
- **`write_id` on the snapshot replaces `persisted` and `storedAt`**, which always move together today. `write_id: string | null` is the stored write this copy builds on, null when nothing is on disk. On disk that's the write that stored the row; in a tab's memory, the last one it read or wrote. A flush sends a copy stamped with the next id and moves `entry.draft.write_id` to it inside the write closure, where `persisted` is set today, so the next write in the chain follows it rather than being refused for this tab's own write.
- **The repository enforces it, inside each write's transaction.** `save(draft, persisted, follows)`, `delete(sessionId, follows)`, `seal(sessionId, inputs, follows)` read the row first and throw `DraftConflictError` if its `write_id` isn't `follows`. A missing row is refused for `save` with a non-null `follows` and for `seal`, but a `delete` of a row already gone succeeds quietly: it's the state asked for. `InMemoryDraftRepository.seal` checks before its `createMany`.
- **The event-index check stays as a backstop.** The write id catches every interleaving it did, but keeping `BulkError` → `DraftConflictError` costs nothing, and without it a collision would become an error repeated on every flush, since `dirty` is restored and the counts never move.
- **A refusal is handled where the session is.**
  - A refused flush, seal or discard of an open session adopts disk with this tab's text as `unsaved`. Seal and discard rethrow; `useDraftSession.save` returns null and `discard` keeps the session, as `save` already does for `StaleVersionError`, since the elsewhere notice says what happened. `sealDraft`'s catch skips its "reschedule the flush" branch for a conflict, which `adoptStored` may have closed.
  - A discard with no open session (DraftsView, or an unreadable draft) follows the list row's or `err.draft`'s `write_id`; refused, it refreshes the list and reports "changed elsewhere", without `adoptStored`, which would open a session nothing holds.
  - A refused `releaseIfEmpty` is silent: another tab wrote work, so keeping the claim is right.
- **Leaving a window flushes too.** `useTabLeave` adds window `blur`, mirroring `useTabReturn`'s `focus`. Without it the rule still catches the side-by-side case, but as a conflict notice; with it the other window's focus check usually reads the write first. Flushing a clean session is a no-op.
- **The return check stays**, demoted from a guard to a courtesy: without it, every return to a tab another has written in would end in a conflict notice at the first keystroke. Flush on leave stays for durability alone.
- **`unsaved` becomes this tab's `DraftSnapshot`**, not its document. The hole this closes is a title-only write, and refused, its document is the stale one this tab never edited: the notice would say "What you had here is below" over text the writer didn't write, and leave out the title they did. `useDraftSession` renders the title and the text; the notice gains a title line. A related draft's parent document rides along but isn't shown: anchors don't read as text to copy. Call sites get simpler, passing `entry.draft`.
- **Kept: `DraftSnapshot` beside `Draft`.** It's one derived line (`DraftOf` without logs), and it's what keeps the unbounded logs out of the drafts list and out of the store, whose recorders own them.
- **Known limit kept:** a flush that starts while `catchUpWithDisk` awaits `list()` reads as another tab's write and reloads quietly. Predates this; not widened by it.
- **Rejected: one writer per draft (Web Locks).** A second tab would open read-only with "take over here". It needs a read-only editor state, a take-over flow and a lock lifecycle, and a take-over that interrupts a write still needs this check underneath. Goes in AUTHORING.md's "Considered and rejected".
- **Rejected: live sync between tabs** (BroadcastChannel, or Dexie's `liveQuery`). More machinery; `liveQuery` ties the draft repository to Dexie ahead of SQLite; a frozen tab misses messages, so the return check would stay anyway.
- **Rejected: committing the hole tests as `it.fails` first.** TESTING.md's fail-first rule is met by running each against unfixed code and reporting the failure.

## Commits

Each hole's test is written first, run against the unfixed code, and its failure reported before the fix. The failure must come from the hole — the stale write landing — not from a missing parameter: write the test against the current signatures where it can, or add the parameter (ignored) before the test.

**Overlap rule:** a new test is added only where no existing one already proves it; each one below names the existing test nearest it and what happens to that test. Before writing each, grep its spec for the behavior and confirm.

0. **Ids are a utility.** `IdClock`, `advanceIdClock`, `newId`, `newTimestamp` in `src/utils/id.ts`, its tests moved from `types/entry.test.ts` to `utils/id.test.ts`.
1. **A tab writes only over the draft it has seen.** One commit: one rule, and splitting it would leave stale seals and deletes silent between commits. The uncommitted "Draft safety" section and citation fixes, plus:
   - **Source.**
     - `types/draft.ts`: `write_id: string | null` on `DraftOf`. `makeDraft` and `seedDraft` take one.
     - `DraftRepository`: `save`, `delete`, `seal` take `follows`, checked in-transaction by both adapters through one small helper each.
     - `draftsStore`: `persisted` and `storedAt` give way to `entry.draft.write_id`; `flush` stamps `newId()` inside its write closure; `catchUpWithDisk` compares write ids; `flush`'s delete-on-empty, `discardDraft`, `releaseIfEmpty`, `sealDraft` pass `follows` and handle refusal as in Decisions; `ChangeElsewhere.unsaved` is a `DraftSnapshot`.
     - `useDraftSession`: `save` and `discard` treat `DraftConflictError` as handled; `unsavedText` gains the title. `DraftElsewhereNotice` shows it.
     - `useTabVisibility`: `useTabLeave` listens for `blur`.
   - **Tests, contract** (`draftRepository.contract.ts`):
     - New: "refuses a title-only save that follows a write it never saw" _replaces_ "takes a save with no events to append…", which asserts the hole.
     - New: "refuses a save to a draft removed since". Nearest: "forgets a session's events when its draft is deleted", which saves with `follows` null and stays.
     - New: "refuses to delete a draft written since"; "deletes a draft already gone without complaint". Nearest: "deletes a draft…", which stays as the plain case.
     - New: "refuses to seal a draft written since, writing no entry". Nearest: "leaves the draft exactly as it was when its entries are refused", a stale _entry_, which stays.
     - "refuses to append over events already stored…" becomes the backstop's test: same `follows`, stale counts.
     - _Cut:_ "refuses a save that conflicts on the parent log alone". It existed because the index check ran per log; under write ids the parent log is no separate path.
   - **Tests, store** (`draftsStore.test.ts`):
     - No new test for the title-only hole: the contract proves the refusal, and "reports a resume's own write losing to another tab, with what this tab had" proves a refused flush adopts disk. That test changes to assert `unsaved` is the snapshot.
     - New: a stale tab empties its copy, and the other tab's words stay on disk.
     - New: a stale seal is refused, writes no entry, and adopts disk. Nearest: "still writes what was typed since the last flush when a seal is refused", a stale entry, which stays.
     - New: a stale discard is refused. Nearest: "leaves the session open when a discard fails", a failing write, which stays.
     - New: a claim another tab wrote in between `releaseIfEmpty`'s read and delete survives, quietly.
   - **Tests, UI.**
     - `DraftElsewhereNotice.browser` and `.cy`: "shows what this tab had below the notice, to copy" gains a title; its screenshot is updated. No new test.
     - The spec covering `useDraftSession.save`'s stale path: a refused seal shows the elsewhere notice and no error. Check NewEntryView's conflict flow first (CODE_REVIEW.md, A6); if it already reaches this, extend it instead.
     - `App.flow`: "writes what was typed at once when the window loses focus", beside the hidden and pagehide tests.
   - **AUTHORING.md:** the table's conflict row becomes the write-id rule covering save, delete and seal; the flush row names window blur; "The one silent path" goes; the `Draft` code block gains `write_id`; "Considered and rejected" gains Web Locks and live sync.
   - **Verify:** `npm run typecheck`, and the unit specs per step (`npm run test -- src/repositories src/stores/draftsStore.test.ts`). A type, repository and store change, so the full suites end it: `npm run test:browser`, `npm run cy:run`.

## Follow-up, not this plan

**Could drafts map onto entries more directly?** Raised while weighing `DraftSnapshot`. Sealing today isn't a reshaping but a set of decisions, in `entriesStore.inputsForDraft`: a `new_related` draft seals into one entry or two depending on whether anchors were placed, its relation type is read off those anchors, and a revision is refused when nothing changed. So a draft reads as an entry in progress plus a plan for which entries it becomes. The question is whether `DraftOf` and `kind` could be shaped closer to `CreateEntryInput`, so less is translated at the seal and the drafts list, views and store speak more in entry terms. It touches everything in AUTHORING.md's "Drafts" section, so it starts as its own investigation: list each field a draft holds and where its entry counterpart comes from, then judge. When this plan closes, this note moves to CHRONICLE_PLAN.md, since the plan file is deleted.

## Manual check

Open one draft in two windows side by side. Type a sentence in the first, click straight into the second and change its title, then click back and forth. Both windows should end up showing the sentence and the new title, with no conflict notice; the drafts list should show one draft.
