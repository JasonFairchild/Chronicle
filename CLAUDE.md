# Chronicle — Claude Code Instructions

Local-first PWA life-mapping / journaling app. First a portfolio piece showing web engineering to employers, second a personal tool — so a PWA and a TypeScript project before anything else. Each addition should show solid engineering without overcomplicating the product or the code.

Every record is one immutable `Entry`; updates, annotations, connections, and revisions are Entries too. Immutability and reconstructible history — current state or state at time T, via the repository plus the pure `reconstructEntryState` — are core features.

## Other docs — list headings, then read the sections that cover your change

| Doc | Authority on | Read before changing |
| --- | --- | --- |
| ENTRY_MODEL.md | entries, anchors, versions, connections | `src/types/entry.ts`, `src/domain/`, `src/repositories/` |
| AUTHORING.md | capture, marks, mark sets, drafts | `traceRecorder`, `marks`, `editor/replay`, `markFrames`, draft stores |
| TESTING.md | how tests are written; every source file has a spec of its own | any test, or a source file without one |
| PRODUCT.md | behavior: built, decided, maybe | anything user-visible |
| CHRONICLE_PLAN.md | priorities and decided engineering work | planning or scoping work |
| ARCHITECTURE.md | the one-page diagram of layers and flow; type names by stage | adding, removing or rerouting a store, table, repository or flow; naming a shared type |

Follow a citation (`TESTING.md §4`, `AUTHORING.md, "Drafts"`) with `npm run cite -- '<ref>'`, which prints only what it lands on, rather than reading its file, unless you're changing that file.

## Rules

**These rules are decisions, and any of them may be questioned on its merits.** PRODUCT.md §2's promises and ENTRY_MODEL.md's two invariants change only when the user changes them, but how the code serves them is open like everything else. A design rule holds while its reason does, so it is written with its reason. When a rule seems to cost more than it saves, when asked whether one is needed, or when changing what its reason names, check the reason against today's code. If it no longer holds, say so and make the case; never deviate silently.

### Changing code

- **No backward compatibility until we deliberately decide it's needed** — including entries in a browser's IndexedDB, which is all test data for now. Change a shape and update every call site, with no fallback for the old one. If old local data breaks, clear IndexedDB or reseed; don't migrate or tolerate it.
- **Single-user app: make the common path work, and give a rare race the smallest backstop that holds** — an existing field or constraint before new machinery.
- **Verify what's in scope; the hooks run the rest.** Pre-commit lints, typechecks, and runs every unit spec and the unused-code and citation checks; pre-push runs both component suites.

### Comments

- **A comment is one line of non-obvious why, for a reader at that line.** Not what the code says, not why it changed (the commit says that), not what a checked-in doc says (cite the doc, once per file). A second line needs a reason the first can't hold. Cite nothing that outlives the session: no plan, chat, or "Piece N". A comment saying what breaks without a line is checked by removing that line.
- **Comment style says where a note is read, once a note has earned its place; many declarations need none.** An editor shows a `/** */` on hover wherever its name is used; a `//` is read only beside its code. So a note on a named declaration at the top of a module or a setup scope (`<script setup>`, a composable, a setup store), exported or not, refs and computeds included; on any function or method; and on a member of a type, class, props or emits is a `/** */`, one line when its text fits. Everything else is `//`: a file's header, a note inside any other function body, and a note covering several declarations. A short note on one statement trails it, moved above only if it won't fit.

### Where code goes

- **Types live by who uses them.** Shapes that are stored or cross layers go in `src/types/`; a module's own inputs, outputs and errors live beside it.
- **Files read top-down.** A helper goes above its first caller; lint catches functions but not class methods called through `this`. A store's or composable's helper that it doesn't return and that reads none of its state goes at module level, above it, so everything inside depends on that state. In a component, store or composable: setup first, then actions in the order they're used, teardown last unless it sits beside the setup it undoes; a `return` lists state, then actions, in file order.

### UI

- **Semantics first.** Native elements before ARIA; reach for a role or `aria-*` only where no element does the job (the editor's `contenteditable` body is the standing example).
- **Disable a control only while its action is in flight, or while it has nothing to act on and its state says so itself, as Undo with no history.** Otherwise leave it enabled and say why it can't proceed.

## Landmarks

- `src/editor/` — schema and the guarded, anchor-aware document commands live only in `extensions.ts`, `anchorIndex.ts`, `anchorCommands.ts` and `anchorGuard.ts`; a second definition or a hand-rolled transaction silently breaks "no related entry is destructive" or anchor-mode exclusivity. A component holding an `Editor` to mount it or drive TipTap UI (`DocumentEditor.vue`, `AnchorMenu.vue`) is fine.
- `src/repositories/index.ts` — the composition root, reached only from stores and `useMedia` (lint holds this). Four interfaces, each with one persistent adapter that tests run too (node on `fake-indexeddb`). Entries and drafts, which SQLite will replace, each have a `.contract.ts` the replacement must also pass.
