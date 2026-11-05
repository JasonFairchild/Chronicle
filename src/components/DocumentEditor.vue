<script lang="ts">
import type { ChangeSignals } from '@/types/entry'

/**
 * One editor change, as the draft buffer records it. `ChangeSignals` are required here, not
 * optional as they are on `AuthoringChange`: this is the one emit site actually producing them, so
 * the compiler should catch a call that forgets one when a signal is added.
 */
export interface EditorChange extends ChangeSignals {
  /** The document's body as it now stands, serialized the way an entry stores it. */
  content: string
  /** Serialized ProseMirror steps for this change, in order. */
  steps: unknown[]
}
</script>

<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import AnchorMenu from '@/components/AnchorMenu.vue'
import EditorToolbar from '@/components/EditorToolbar.vue'
import { useMedia } from '@/composables/useMedia'
import { collectAnchors } from '@/domain/anchors'
import { type EntryDocument, parseDocument } from '@/domain/entryDocument'
import { readAnchorAnnouncement } from '@/editor/anchorCommands'
import { changeSignals } from '@/editor/changeSignals'
import { entryExtensions } from '@/editor/extensions'

const props = withDefaults(
  defineProps<{
    /** Accessible name for the editing surface. Unused when `displayOnly`, which has none. */
    label: string
    /** Seed content, serialized. Read once, on mount: the editor owns the document after that. */
    content?: string
    /** Editing paused, as while a save is in flight; the editor keeps its look. */
    disabled?: boolean
    /**
     * A stored document shown for reading: no box, no toolbar, and not announced as a textbox,
     * since nothing here can be typed. Rendered by this editor's schema all the same, so anchors and
     * images look exactly as they did while being written.
     */
    displayOnly?: boolean
    /**
     * The other creation experience (ENTRY_MODEL.md, "Two creation experiences, kept separate").
     * The parent's own text can't change: typing becomes wording, the anchor menu
     * (`AnchorMenu.vue`) takes formatting's place, and the toolbar keeps only Undo and Redo.
     */
    anchorMode?: boolean
    /**
     * The document as it stood when this **session** began, in `anchor-mode` only — for a resumed
     * draft, the version `Draft.parent.base_version_id` names. Omitted for a fresh session, where `content` is already
     * that base. Read once, on mount, alongside `content`: it is what tells an anchor this session
     * placed before a reload apart from one an earlier related entry sealed, since both are simply
     * *there* in the document a resumed editor mounts with (AUTHORING.md, "Drafts").
     */
    anchorBaseContent?: string
    /** Id of an element describing how to use this editor, wired to `aria-describedby`. */
    describedBy?: string
  }>(),
  {
    content: '',
    disabled: false,
    displayOnly: false,
    anchorMode: false,
    anchorBaseContent: undefined,
    describedBy: undefined,
  },
)

const emit = defineEmits<{
  change: [change: EditorChange]
}>()

const media = useMedia()

const initialDocument = parseDocument(props.content)

/** Scaffolding steps not yet reported; see `onUpdate`. */
let heldSteps: unknown[] = []

/**
 * Two presentations for anchor wording exist in the CSS below: inline (trailing the marked text, in
 * flow — what ships) and interlinear (raised above the caret, proofreader's-markup style, out of
 * flow). Interlinear turned out to be tricky to get right — it wants to float "mainly placed with
 * the caret" without pushing or overlapping trailing text, which a first attempt didn't land — so
 * it's parked here rather than removed, for whenever there's a real display-setting to choose
 * between them (PRODUCT.md, "Making anchor ops unmistakable").
 */
const ANCHOR_MARKUP_MODE: 'inline' | 'interlinear' = 'inline'

/**
 * `data-anchor-markup` only belongs on a document that actually carries an anchor — plain writing
 * surfaces keep the ordinary line height regardless of which mode above is active. Read from
 * whatever the document currently holds rather than only `initialDocument`, so an anchor placed
 * mid-session switches this on live, the same as one sealed earlier.
 */
function anchorMarkupAttr(document: EntryDocument): Record<string, string> {
  return collectAnchors(document).length > 0 ? { 'data-anchor-markup': ANCHOR_MARKUP_MODE } : {}
}

/**
 * What the polite live region below announces. An anchor command's only visible feedback is a color
 * change inside a contenteditable, which assistive tech cannot see, so each one is spoken instead.
 */
const liveRegionMessage = ref('')

const editor = useEditor({
  // The guard (`anchorGuard.ts`) seals the anchors of the document this editor opens with, or in
  // anchor mode of the session's base. It relies on this editor never being handed a new document:
  // each composer keys it on the session's `editorKey`.
  extensions: entryExtensions({
    anchorMode: props.anchorMode,
    baseContent: props.anchorBaseContent,
  }),
  content: initialDocument,
  // StarterKit's input rules each make a block or a mark, which anchor mode's guard refuses,
  // swallowing the keystroke that completed one: the space in "- ".
  enableInputRules: !props.anchorMode,
  editable: !props.disabled && !props.displayOnly,
  editorProps: {
    attributes: {
      // A contenteditable div has no implicit role, so it is spelled out here rather than left to
      // a test id: this is the field a person types into and it should say so.
      ...(props.displayOnly
        ? {}
        : { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.label }),
      // The anchor-mode modifier keeps the selection visibly painted even once focus leaves the
      // editor for a menu control — see the `::selection` rule below, and `AnchorMenu`'s own
      // `shouldShow` override for the analogous problem on the menu's own side.
      class: props.displayOnly
        ? 'chronicle-document'
        : props.anchorMode
          ? 'chronicle-document chronicle-document--anchor min-h-32'
          : 'chronicle-document min-h-32',
      ...(props.describedBy ? { 'aria-describedby': props.describedBy } : {}),
      ...anchorMarkupAttr(initialDocument),
    },
  },
  onUpdate: ({ editor: instance, transaction, appendedTransactions }) => {
    // Plugins append transactions of their own (an autolink, the paragraph after a trailing
    // heading), and the log must carry their steps too or it won't replay to the document.
    const applied = [transaction, ...appendedTransactions]
    const steps = applied.flatMap((tr) => tr.steps.map((step) => step.toJSON()))
    // A document only changes through steps, so no steps means nothing changed and there is
    // nothing to report. Editors emit updates for housekeeping too, and treating one of those as
    // a real edit is what starts a writing session nobody began.
    if (steps.length === 0) return

    const document = instance.getJSON() as EntryDocument

    if (collectAnchors(document).length > 0) {
      instance.view.dom.setAttribute('data-anchor-markup', ANCHOR_MARKUP_MODE)
    } else {
      instance.view.dom.removeAttribute('data-anchor-markup')
    }

    // Only a plugin's steps, appended to a transaction that changed nothing itself: scaffolding
    // the writer didn't do, so it waits for their next change rather than starting a session.
    if (transaction.steps.length === 0) {
      heldSteps.push(...steps)
      return
    }
    // Held steps go first, so the log still replays to the document this change reports.
    const reported = [...heldSteps, ...steps]
    heldSteps = []

    if (props.anchorMode) {
      const announcement = readAnchorAnnouncement(transaction)
      if (announcement) liveRegionMessage.value = announcement
    }

    emit('change', {
      content: JSON.stringify(document),
      steps: reported,
      ...changeSignals(transaction, document),
    })

    void nextTick(() => media.applyTo(instance.view.dom))
  },
  onCreate: ({ editor: instance }) => {
    void media.applyTo(instance.view.dom)
  },
})

// The second argument suppresses an update event. Whether a document may be edited is not a change
// to the document, and TipTap emits one by default.
watch(
  () => props.disabled,
  (disabled) => editor.value?.setEditable(!disabled && !props.displayOnly, false),
)

onBeforeUnmount(() => editor.value?.destroy())

/** Puts the caret in the document, for a field beside it to hand over to, such as the title. */
function focus(): void {
  // The view's own focus rather than `commands.focus()`, which defers to the next animation frame:
  // a character typed within ~16ms would land back in the field that handed over.
  editor.value?.view.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    :class="{
      'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)]': !displayOnly,
    }"
  >
    <AnchorMenu v-if="editor && anchorMode" :editor="editor" />

    <!-- Mounted with the mode rather than with its first message: a live region has to be in the
         DOM before it updates to be announced reliably. -->
    <p v-if="anchorMode" class="sr-only" role="status" aria-live="polite">
      {{ liveRegionMessage }}
    </p>

    <EditorToolbar
      v-if="editor && !displayOnly"
      :editor="editor"
      :label="label"
      :disabled="disabled"
      :history-only="anchorMode"
    />

    <EditorContent
      :editor="editor"
      class="text-sm leading-relaxed"
      :class="{ 'px-3 py-2': !displayOnly }"
    />
  </div>
</template>

<style scoped>
/*
  The editor renders ProseMirror's own DOM, so these have to pierce scoping. Sizes and weights
  only — every color stays on a CSS variable so dark mode is a token swap.
*/
:deep(.chronicle-document p) {
  margin-bottom: 0.5rem;
}

:deep(.chronicle-document h2) {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.375rem;
}

:deep(.chronicle-document h3) {
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 0.375rem;
}

:deep(.chronicle-document ul) {
  list-style: disc;
  padding-left: 1.25rem;
}

:deep(.chronicle-document ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}

:deep(.chronicle-document blockquote) {
  border-left: 2px solid var(--color-border);
  padding-left: 0.75rem;
  color: var(--color-text-muted);
}

:deep(.chronicle-document a) {
  color: var(--color-accent);
  text-decoration: underline;
}

:deep(.chronicle-document img) {
  max-width: 100%;
  border-radius: 0.5rem;
}

/*
  Anchor highlight colors come from the system scheme (main.css) rather than anything stored on
  the mark — see ENTRY_MODEL.md, "Color". Comment and strike share the mark and differ only by the
  `data-anchor-kind` attribute the mark renders.
*/
:deep(.chronicle-document .chronicle-anchor) {
  border-radius: 0.15rem;
}

:deep(.chronicle-document .chronicle-anchor[data-anchor-kind='comment']) {
  background-color: color-mix(in srgb, var(--color-anchor-comment) 45%, transparent);
}

:deep(.chronicle-document .chronicle-anchor[data-anchor-kind='strike']) {
  background-color: color-mix(in srgb, var(--color-anchor-strike) 45%, transparent);
  text-decoration: line-through;
}

/*
  No margin or padding on anchors or wording: spacing is the author's, typed as characters, so an
  insertion mid-word sits flush and the page shows exactly the text that's stored.
*/
:deep(.chronicle-document .chronicle-anchor-insert) {
  text-decoration: none;
}

/*
  Inline presentation — active (`ANCHOR_MARKUP_MODE` above is 'inline'). Wording trails straight
  after the marked passage in normal flow, like ordinary text, with no separate glyph marking where
  it starts — a colored underline, as track changes marks an insertion, is what reads as "this is
  proposed wording, not the original". It runs under spaces too, so wording that's only a space
  still shows. A caret glyph was tried here too and taken back out: pointing up reads fine when the
  wording is actually above (see the dormant presentation below), but pointing at nothing when it's
  sitting right next to the wording on the same line just looks like a stray mark.
*/
:deep(.chronicle-document .chronicle-anchor-wording) {
  color: var(--color-anchor-insert);
  text-decoration: underline;
}

/*
  Interlinear presentation — dormant. `ANCHOR_MARKUP_MODE` above is hardcoded to 'inline', so
  `data-anchor-markup` never actually reaches 'interlinear' and none of the rules below ever match.
  Kept rather than deleted for whenever there's a real display-setting to choose between the two
  presentations (PRODUCT.md, "Making anchor ops unmistakable").

  The idea: float the wording above a caret glyph left on the baseline, rather than trailing it. The
  caret is a `::before` on the `<ins>` rather than a DOM node, so it never becomes part of the
  wording's own text — and it earns its keep here in a way it doesn't for the inline presentation
  above: pointing up at wording that's actually above it reads as a real pointer, not a stray mark.
  `position: absolute` on the wording deliberately takes it out of flow so it reserves no horizontal
  room; `left: 0` lines its own left edge up with the caret's, which is what "mainly placed with the
  caret" means. The doubled line-height gives the float clearance above the line. What stalled this
  attempt: long wording can overlap whatever text follows on a tightly packed line, which read as a
  bug rather than an accepted proofreading-markup limit when it was tried live — worth another pass,
  not worth losing. If this comes back, a color scheme covering arbitrary text in the parent (see
  "Making anchor ops unmistakable") is worth rechecking against too — underline-plus-color as "this
  is wording, not original text" gets weaker the more the original text is itself colored.

:deep(.chronicle-document .chronicle-anchor-insert) {
  position: relative;
}

:deep(.chronicle-document .chronicle-anchor-insert::before) {
  content: '⌃';
  color: var(--color-anchor-caret);
}

:deep(.chronicle-document .chronicle-anchor-wording),
:deep(.chronicle-document .chronicle-anchor-wording--open) {
  position: absolute;
  left: 0;
  bottom: 100%;
  white-space: nowrap;
}

:deep(.chronicle-document[data-anchor-markup='interlinear']) {
  line-height: 2.75;
}
*/

/*
  A visible ring wherever the browser's own outline was suppressed for layout reasons. Kept off
  `outline-none` at rest so a mouse click never shows one, matching `EditorToolbar`'s buttons.
*/
:deep(.chronicle-document:focus-visible) {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
  border-radius: 0.25rem;
}

/*
  Keeps the marked passage visibly selected even once focus moves to `AnchorMenu`'s own controls —
  browsers otherwise dim or drop the painted selection the moment a contenteditable loses focus,
  which would leave a keyboard user unable to see what a Highlight or Strike click is about to act
  on. Unconditional on focus state, so it applies the same whether the mouse or the keyboard placed
  the menu.
*/
:deep(.chronicle-document--anchor ::selection) {
  background-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
}

/*
  The caret takes the wording's color anywhere in anchor mode, since whatever is typed there becomes
  wording. That holds at a wording's start too, where ProseMirror draws the caret at the end of the
  passage before it, outside the box.
*/
:deep(.chronicle-document--anchor) {
  caret-color: var(--color-anchor-insert);
}

/*
  Anchor mode's decorations (`anchorModeDecorations`, `anchorCommands.ts`). Wording the session
  placed tints on hover, as something a click returns to. The wording at the caret is outlined as
  an open box, and a passage at the caret with no wording yet shows a placeholder box. Each box
  stands a margin clear of the passage, so its outline never crosses the passage's last letter, and
  the open box is padded on its end side, clear of the wording's. The caret is left where
  ProseMirror draws it, at a box's edge rather than inside it.
*/
:deep(.chronicle-anchor-wording--editable:hover) {
  background-color: color-mix(in srgb, var(--color-anchor-insert) 15%, transparent);
}

:deep(.chronicle-anchor-wording--open),
:deep(.chronicle-anchor-placeholder) {
  outline: 1px solid var(--color-anchor-insert);
  border-radius: 0.25rem;
  margin-inline-start: 0.15em;
  padding-inline-end: 0.2em;
}

:deep(.chronicle-anchor-placeholder) {
  padding-inline-start: 0.2em;
  color: var(--color-text-muted);
  font-size: 0.82em;
  font-style: italic;
  pointer-events: none;
}
</style>
