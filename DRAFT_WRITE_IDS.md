# A tab writes only over the draft it has seen

Status: done 2026-10-25. This file is deleted when commit 3 lands, once anything that outlasts it is in the docs.

## Context

A draft open in two tabs relies on two guards: event rows are added, never put, so two tabs can't append at one index; and a tab being returned to reloads what another wrote. Neither stops a write that appends no events, or one from a tab whose return check ran before the other tab's write landed. Two windows side by side make that easy: both stay visible, so leaving one doesn't flush it, and its 300 ms flush can land after the other window has already checked. Found so far, each silent:

1. A title- or dates-only save from a stale tab replaces the snapshot, so the other tab's words leave it, while the event log still replays to them.
2. A save after the draft was sealed or discarded elsewhere recreates the row, holding only the tail of a log.
3. Emptying a stale tab's copy deletes the row, and the other tab's words and events with it.
4. Sealing from a stale tab writes its older text as the entry and removes the newer draft.
5. A stale discard, or `releaseIfEmpty` reading the row then deleting it in a second transaction, removes words written in between.

One rule closes all of them: **every write to a draft row names the write it follows, and is refused if disk holds a different one.**

## Decisions

- **A write id, not `updated_at`, is the version.** Each save stamps the row with a fresh `newId()` (UUIDv7, as session ids already are). Reviewed against the smaller alternative — `updated_at` as the version, with `addMark` made to restamp it — and kept, for two reasons:
  - _Tests write faster than a person._ With in-memory adapters, two tabs' writes routinely land in one millisecond; under fake timers every stamp is identical. A millisecond version would let a stale write through there, so the hole tests could pass or fail by timing, and every multi-tab test would need to step the clock (one already does, in `draftsStore.test.ts`). A random id has no tie to fall into.
  - _One stamping site._ `updated_at` is stamped at each change site (`replaceSnapshot`, `startingSnapshot`), and `addMark` already misses it. A write id is stamped where the write is made, so no future change path can forget it.
  - _The cost:_ one field on `DraftOf`, its fixtures, and AUTHORING.md's code block. `updated_at` keeps one job: ordering and showing the drafts list.
- **`write_id` on the snapshot replaces `persisted` and `storedAt`**, which always move together today. `write_id: string | null` is the stored write this copy builds on, null when nothing is on disk. On disk that's the write that stored the row; in a tab's memory, the last one it read or wrote. A flush sends its copy as is and sets `entry.draft.write_id` to the id `save` returns, inside the write closure where `persisted` is set today, so the next write in the chain follows it rather than being refused for this tab's own write.
- **The repository stamps and enforces it, inside each write's transaction.** `save(draft)` follows `draft.write_id`, stamps a new id and returns it, as the other repositories stamp the ids they store; `delete(sessionId, follows)` and `seal(sessionId, inputs, follows)` name it outright. Each reads the row first and throws `DraftConflictError` if its `write_id` isn't the one followed. A missing row is refused for `save` with a non-null `follows` and for `seal`, but a `delete` of a row already gone succeeds quietly: it's the state asked for. `InMemoryDraftRepository.seal` checks before its `createMany`.
- **The repository works out each log's tail, so `PersistedEvents` goes.** With the write it follows confirmed, what's stored is the start of what the draft holds, so `save` appends past the stored length (Dexie counts the document's key range in the same transaction). That retires the store's `persistedEvents`, `eventCounts` and their reset after a delete, and the event-index collision check with its `BulkError` mapping and test: counts the repository derives can't drift from disk. Costs one indexed count per log per flush.
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

0. **Ids are a utility.** `IdClock`, `advanceIdClock`, `newId`, `newTimestamp` in `src/utils/id.ts`, its tests moved from `types/entry.test.ts` to `utils/id.test.ts`. **Split: the rule, then its handling.** Commit 1 refuses every stale write, so no hole stays silent between commits; what it leaves rough is how a refused seal or discard reads, as the store's raw "changed in another tab" error rather than the elsewhere notice. Commit 3 turns those refusals into catching up. Rejected: one commit, at about twice the diff, when the second half (session, notice, blur, UI specs) reads as its own story.

1. **A tab writes only over the draft it has seen.** The uncommitted "Draft safety" section, citation fixes and CLAUDE.md line, plus:
   - **Source.**
     - `types/draft.ts`: `write_id: string | null` on `DraftOf`. `makeDraft` takes the `writeId` it follows, null by default; `seedDraft` is a plain `save`.
     - `DraftRepository`: `save(draft): Promise<string>` drops `persisted`; `delete` and `seal` take `follows`; all checked in-transaction by both adapters through one shared `assertFollows` beside `DraftConflictError`. `seal` checks for itself, since `delete` takes a row already gone; Dexie's then calls `delete` inside its transaction, while the in-memory one checks once before `createMany` and removes unchecked after, so a write landing during that await can't strand its entries.
     - `draftsStore`, adopting the rule and no more:
       - `persisted`, `storedAt`, `persistedEvents` and `eventCounts` give way to `entry.draft.write_id`. `open`'s `persisted` parameter goes (`write_id !== null` says it), and `startingSnapshot` sets `write_id: null`.
       - `flush` sets `entry.draft.write_id` to the id `save` returns, inside its write closure, on whatever `entry.draft` is by then: a snapshot replaced during the await still carries the old id. Its delete-on-empty follows `write_id` and sets it null.
       - `catchUpWithDisk` compares write ids. `sealDraft` and `releaseIfEmpty` pass `follows`; a refused `releaseIfEmpty` is silent (Decisions).
       - `discardDraft` follows the open session's `write_id`, or one its caller passes for a draft no session holds: DraftsView's list row, `useDraftSession`'s unreadable draft. Refused, it throws as any failed discard does today.
       - The `flushing` waits in seal and discard stay, with comments changed: a session's first write follows none, so landing after them it would still recreate the row, and a later one would refuse them as a false conflict.
       - `loadDrafts` and `catchUpWithDisk` first wait for this tab's writes under way (`writesLanded`): a list read before its own last write lands names the write before it, so discarding from DraftsView right after leaving a composer was refused as "changed in another tab".
   - **Tests, contract** (`draftRepository.contract.ts`):
     - New: "refuses a title-only save that follows a write it never saw" _replaces_ "takes a save with no events to append…", which asserts the hole.
     - New: "refuses a save to a draft removed since". Nearest: "forgets a session's events when its draft is deleted", which saves with `follows` null and stays.
     - New: "refuses to delete a draft written since"; "deletes a draft already gone without complaint". Nearest: "deletes a draft…", which stays as the plain case.
     - New: "refuses to seal a draft written since, writing no entry". Nearest: "leaves the draft exactly as it was when its entries are refused", a stale _entry_, which stays.
     - New: "refuses to seal a draft removed since, so its entry is never written twice". Without it, on Dexie, dropping `seal`'s own check (leaving it to `delete`) passes every other test.
     - New: "refuses a first save over a draft another tab has stored". Without it, `assertFollows` letting any null `follows` through passes every other test.
     - _Cut:_ "refuses to append over events already stored…" and "refuses a save that conflicts on the parent log alone", with the index check they proved. "appends only the events it has not already stored" and "reassembles a resumed session's logs" prove the derived tail, both logs.
   - **Tests, store** (`draftsStore.test.ts`): existing tests move to the new signatures (a held `save` spy, the other tab's direct `save`). No new test for the title-only hole: the contract proves the refusal, and "reports a resume's own write losing to another tab, with what this tab had" proves a refused flush adopts disk.
     - New: a stale tab empties its copy, and the other tab's words stay on disk.
     - New: a claim another tab wrote in between `releaseIfEmpty`'s read and delete survives, quietly.
     - New: "writes a draft again once it is typed in after being emptied", proving delete-on-empty resets `write_id`.
     - New: "lists a draft as this tab last wrote it, so discarding it from the list follows that write".
   - **Tests, UI:** none new. NewEntryView's two specs that delete a draft "elsewhere" follow its stored `write_id`.
   - **AUTHORING.md:** the table's conflict row ("Event rows are added, never put…") becomes the write-id rule covering save, delete and seal, with the repository appending past what's stored; the return row compares write ids, not `updated_at`; "The one silent path" goes; the `Draft` code block gains `write_id`; "Considered and rejected" gains Web Locks and live sync.
   - **Verify:** `npm run typecheck`, and the unit specs per step (`npm run test -- src/repositories src/stores/draftsStore.test.ts`). A type, repository and store change, so the full suites end it: `npm run test:browser`, `npm run cy:run`.
2. **Seed drafts with `save`.** `seedDraft` became a one-line wrapper in commit 1, and TESTING.md holds that one that only shortens a call doesn't earn its place, so its call sites across the view, component and flow specs call `draftRepository.save` directly, and it goes. Before commit 3, so its new specs are written without it. Test-only and mechanical.
   - **Verify:** `npm run typecheck`, then the browser and Cypress specs it touched (`npm run test:browser`, `npm run cy:run`), since it changes shared test setup.
3. **A refused write catches up, not fails.**
   - **Source.**
     - `draftsStore`: a refused seal or discard of an open session adopts disk with this tab's snapshot as `unsaved`, and rethrows; `sealDraft`'s catch skips its "reschedule the flush" branch for a conflict. A refused discard with no open session refreshes the list and says "changed elsewhere". `ChangeElsewhere.unsaved` is a `DraftSnapshot`.
     - `useDraftSession`: `save` and `discard` treat `DraftConflictError` as handled; `unsavedText` gains the title. `DraftElsewhereNotice` shows it.
     - `useTabVisibility`: `useTabLeave` listens for `blur`.
   - **Tests, store** (`draftsStore.test.ts`):
     - "reports a resume's own write losing to another tab, with what this tab had" changes to assert `unsaved` is the snapshot.
     - New: a stale seal is refused, writes no entry, and adopts disk. Nearest: "still writes what was typed since the last flush when a seal is refused", a stale entry, which stays.
     - New: a stale discard is refused and adopts disk. Nearest: "leaves the session open when a discard fails", a failing write, which stays.
   - **Tests, UI.**
     - `DraftElsewhereNotice.browser` and `.cy`: "shows what this tab had below the notice, to copy" gains a title; its screenshot is updated. No new test.
     - The spec covering `useDraftSession.save`'s stale path: a refused seal shows the elsewhere notice and no error. Check NewEntryView's conflict flow first (CODE_REVIEW.md, A6); if it already reaches this, extend it instead, and update A6.
     - DraftsView pair: discarding a draft changed elsewhere refreshes the list and says so. Check its discard specs first.
     - `App.flow`: "writes what was typed at once when the window loses focus", beside the hidden and pagehide tests.
   - **AUTHORING.md:** the flush row names window blur; the losing-tab row covers a refused seal or discard.
   - **Verify:** `npm run typecheck`, `npm run test -- src/stores/draftsStore.test.ts`, then a store change, so the full suites: `npm run test:browser`, `npm run cy:run`.

## Follow-up, not this plan

**Could drafts map onto entries more directly?** Raised while weighing `DraftSnapshot`. Sealing today isn't a reshaping but a set of decisions, in `entriesStore.inputsForDraft`: a `new_related` draft seals into one entry or two depending on whether anchors were placed, its relation type is read off those anchors, and a revision is refused when nothing changed. So a draft reads as an entry in progress plus a plan for which entries it becomes. The question is whether `DraftOf` and `kind` could be shaped closer to `CreateEntryInput`, so less is translated at the seal and the drafts list, views and store speak more in entry terms. It touches everything in AUTHORING.md's "Drafts" section, so it starts as its own investigation: list each field a draft holds and where its entry counterpart comes from, then judge. When this plan closes, this note moves to CHRONICLE_PLAN.md, since the plan file is deleted.

## Manual check

Open one draft in two windows side by side. Type a sentence in the first, click straight into the second and change its title, then click back and forth. Both windows should end up showing the sentence and the new title, with no conflict notice; the drafts list should show one draft. Then, in one window, type a word and click Drafts at once, and discard that draft there: it goes, with no "changed in another tab".
