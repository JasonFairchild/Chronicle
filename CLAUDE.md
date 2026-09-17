# Chronicle — Claude Code Instructions

Local-first PWA life-mapping / journaling app; portfolio demo + personal tool. Every record is one
immutable `Entry` — updates, annotations, connections, and revisions are Entries too. Offline is
non-negotiable; immutability and reconstructible history are core features, not niceties.

Stack: Vue 3 + TypeScript + Vite, Tailwind (dark-mode ready), Pinia, Vue Router, TipTap,
vite-plugin-pwa, Dexie today / SQLite WASM + OPFS later, Vitest (unit + Browser Mode) + Cypress CT.

## One command per call. No pipelines.

This is the rule most often broken, so it goes first.

A permission rule matches a **whole** command string. `Bash(npm run:*)` does not cover
`npm run test:browser 2>&1 | tail -20`, and covers `... && npm test` even less — the allowlist sees
one unlisted compound, and prompts. Every `| tail`, `| grep`, `| head`, `&&`, and `;` is another
prompt, whatever the pieces are.

So: **run one command and read its output.** Not `| tail -20` — read the whole thing. Two things to
run means two calls. Reach for Read, Grep and Glob before the shell at all; they never prompt, and
they are better tools than `cat`, `grep` and `find` for the same job.

## The other docs — read the relevant one before changing that area

| Doc               | Authority on                        | Read before                                              |
| ----------------- | ----------------------------------- | -------------------------------------------------------- |
| ENTRY_MODEL.md    | the data model and its reasoning    | `src/types/entry.ts`, `src/domain/`, `src/repositories/` |
| TESTING.md        | how tests are written               | writing or changing any test                             |
| PRODUCT.md        | behavior, and what is built vs next | changing anything user-visible                           |
| CHRONICLE_PLAN.md | phases and what is out of scope     | planning or scoping work                                 |

## Rules that always apply

- **Write rule:** prefer INSERT of new related Entries; never mutate rows for "edits". The draft
  buffer (`src/stores/draftsStore.ts`) really does overwrite rows and is the one sanctioned
  exception — working space, not history.
- **No child entry is destructive.** Only a `revision` writes content.
- **Ordering:** every sort tiebreaks on `id` via `compareEntries`; `created_at` is only
  millisecond-resolution and so is not a total order on its own.
- Reconstructing aggregated current state or state-at-time-T stays easy via the repository plus the
  pure `reconstructEntryState`.
- Tests alongside every feature. `*.test.ts` = pure logic (node), `*.browser.test.ts` = Vitest
  browser, `*.cy.ts` = Cypress, `*.contract.ts` = shared suite, never run directly.
- Composition API + `<script setup>`; all data access behind the repository layer.
- No hard-coded colors that block dark mode.
- Small, focused changes, in code an employer can read and I can explain.
- **Comments cite nothing that outlives the session.** A plan, a chat, or "Piece N" of a design
  discussion isn't something future code — or a future session — can look up; cite a checked-in doc
  (`ENTRY_MODEL.md`, `PRODUCT.md`, ...) or nothing at all. Keep comments proportional to what they sit
  next to: the non-obvious why, stated once, not a walkthrough.
- **Comment style marks scope, not length.** `/** */` heads a unit — file, function (including one
  nested inside another), type, or class — even if the comment is one line. `//` covers a few lines
  within a unit, even if the comment itself spans several lines. A short description or imperative
  on a single field or statement goes as a trailing `//` on that same line, not above it as its own
  comment — move it above only if it doesn't fit on the line. Going forward only; existing comments
  get fixed opportunistically, not in a sweep.
- When two options are equally good, take the one that costs less context.
- Commit messages: a subject line, then only what the diff can't say — why a choice was made, and
  anything a reviewer couldn't discover from the code. No tour of the changes.
- **Draft commits, don't run them.** Propose the message; staging and `git commit` are mine to run,
  every time — don't stage files unless asked directly.
- **No backward compatibility until we deliberately decide it's needed.** This includes entries
  already sitting in a browser's local IndexedDB — at this stage that's all test data. Change a
  shape and update every call site; don't add a fallback to read an old one. If old local data
  stops working, clear the IndexedDB (or seed fresh data) rather than writing code to migrate or
  tolerate it. Revisit only when we deliberately decide real data needs to survive a shape change.

## Landmarks

- `src/domain/entryDocument.ts` — the **only** flattening. Anchors, previews, search, and diff must
  all measure against `docToPlainText`, or an anchor recorded on one ruler resolves on another.
- `src/editor/` — schema and the guarded, anchor-aware commands that mutate the document live only
  in `extensions.ts` and `anchorCommands.ts`; a second definition or a hand-rolled transaction is how
  "no child entry is destructive" or anchor-mode exclusivity gets silently violated. Components may
  still hold an `Editor` instance to mount it or drive built-in TipTap UI (`DocumentEditor.vue`,
  `AnchorMenu.vue`) — that's ordinary UI wiring against an editor built elsewhere, not a second
  source of schema or command truth. The domain layer reads documents as plain JSON either way,
  which is what keeps it pure and node-testable.
- `src/repositories/index.ts` — the composition root. Three interfaces, each with an in-memory
  adapter for tests and a persistent one for the app, each proven by a shared `.contract.ts`.
