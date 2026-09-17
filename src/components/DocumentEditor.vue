<script lang="ts">
/** One editor change, reduced to what the draft buffer and the tick policy need. */
export interface EditorChange {
  /** The document's body as it now stands, serialized the way an entry stores it. */
  content: string
  /** The title field as it now stands, when this editor offers one; null when it doesn't. */
  title: string | null
  /** Serialized ProseMirror steps for this change, in order. */
  steps: unknown[]
  /** Text this change added. Empty for a deletion or a formatting change. */
  insertedText: string
  isFormatting: boolean
  /**
   * Whether this change was a one-shot structural anchor op — place, change kind, or remove —
   * reported in every mode, the same way `isFormatting` is. See `TickEvent.isAnchorOp`
   * (`domain/tickPolicy.ts`): the parent's and the child's authoring streams share one tick policy,
   * and this is the fact it judges alongside `isFormatting`. Typing wording is deliberately never
   * this — it's ordinary text entry, tickable the same way prose is, from `insertedText` below.
   */
  isAnchorOp: boolean
  /**
   * Anchors this session has placed, in `anchor-mode` only. Derived by reading which of the
   * document's current ids aren't sealed (`sessionAnchorIds`, `domain/anchors.ts`) rather than
   * tallied as commands run, so undoing an anchor drops back out on its own — nothing here has to
   * notice an undo and subtract it.
   */
  anchorIds?: string[]
  /**
   * Pre-existing anchors whose covered text this session has disturbed so far, outside anchor
   * mode. Cumulative across the whole session: once an edit changes what an anchor covers, that
   * anchor stays flagged even if a later edit moves the surrounding text back (PRODUCT.md §5.3).
   */
  affectedAnchorIds?: string[]
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import {
  Bold,
  Eraser,
  Image,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MoreHorizontal,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from '@lucide/vue'
import {
  collectAnchors,
  innermostAnchorAt,
  pairableAnchorAt,
  sessionAnchorIds as sessionAnchorIdsIn,
} from '@/domain/anchors'
import { anchorsAffectedBy } from '@/domain/anchorWarnings'
import { useMedia } from '@/composables/useMedia'
import {
  parseDocument,
  sameContent,
  MEDIA_NODE,
  type DocMark,
  type EntryDocument,
} from '@/domain/entryDocument'
import {
  anchorSpans,
  editableAnchorRanges,
  isAnchorCommand,
  mapAnchorSpans,
  markAnchor,
  openAnchorInsert,
  openAnchorWording,
  readAnchorAnnouncement,
  readAnchorTick,
  readAnchorWordingText,
  sealedAnchorIdsOf,
  type AnchorSpan,
} from '@/editor/anchorCommands'
import { entryExtensions } from '@/editor/extensions'
import AnchorMenu from '@/components/AnchorMenu.vue'
import { toErrorMessage } from '@/utils/format'
import type { AnchorKind } from '@/types/entry'

const props = withDefaults(
  defineProps<{
    /** Accessible name for the editing surface. */
    label: string
    /** Seed content, serialized. Read once, on mount: the editor owns the document after that. */
    content?: string
    /** Seed title, when `withTitle` is set. Read once, on mount, same as `content`. */
    title?: string | null
    /** Titled entries get the title field above the toolbar; untitled ones do not. */
    withTitle?: boolean
    disabled?: boolean
    /**
     * The other creation experience (ENTRY_MODEL.md, "Two creation experiences, kept separate").
     * Surrounding text becomes unreachable — only the anchor menu (`AnchorMenu.vue`) and the
     * keyboard shortcuts it mirrors can change the document — and the ordinary formatting toolbar
     * gives way to it.
     */
    anchorMode?: boolean
    /**
     * The document as it stood when this **session** began, in `anchor-mode` only — a resumed
     * draft's `Draft.parent.base_content`. Omitted for a fresh session, where `content` is already
     * that base. Read once, on mount, alongside `content`: it is what tells an anchor this session
     * placed before a reload apart from one an earlier child sealed, since both are simply *there*
     * in the document a resumed editor mounts with (ENTRY_MODEL.md, "Drafts").
     */
    anchorBaseContent?: string
    /** Id of an element describing how to use this editor, wired to `aria-describedby`. */
    describedBy?: string
  }>(),
  {
    content: '',
    title: null,
    withTitle: false,
    disabled: false,
    anchorMode: false,
    anchorBaseContent: undefined,
    describedBy: undefined,
  },
)

const emit = defineEmits<{
  change: [change: EditorChange]
}>()

const media = useMedia()
const fileInput = ref<HTMLInputElement | null>(null)
const attachError = ref<string | null>(null)

// Seeded once, on mount: the editor owns the document after that, and the title field owns
// `titleText` the same way.
const titleText = ref(props.withTitle ? (props.title ?? '') : '')

// Captured once, so anchor mode can tell "placed this session" apart from "was already there" for
// as long as this editor instance lives — the same document this editor opened, never reassigned.
const initialDocument = parseDocument(props.content)

/**
 * The title half of every emitted change. Blank collapses to null the same way a stored title
 * always has, so an abandoned keystroke in the field doesn't outlive the session as an empty
 * string, and a session where the field isn't offered at all can never report one.
 */
function emittedTitle(): string | null {
  if (!props.withTitle) return null
  return titleText.value.trim() || null
}

/**
 * The anchors already in the document, moved forward one transaction at a time — text mode only.
 * Reassigned after every edit so the next one resumes tracking from where this one left off,
 * rather than needing to compose every step's `Mapping` since the session began.
 */
let liveAnchorSpans: AnchorSpan[] = []
/** Anchors this session has disturbed so far. Sticky: once flagged, an anchor stays flagged. */
const affectedAnchorIds = new Set<string>()

/**
 * Two presentations for anchor wording exist in the CSS below: inline (trailing the marked text, in
 * flow — what ships) and interlinear (raised above the caret, proofreader's-markup style, out of
 * flow). Interlinear turned out to be tricky to get right — it wants to float "mainly placed with
 * the caret" without pushing or overlapping trailing text, which a first attempt didn't land — so
 * it's parked here rather than removed, for whenever there's a real display-setting to choose
 * between them (PRODUCT.md, "Making anchor ops unmistakable": "Inline vs. interlinear wording
 * placement is a second thing that same setting would choose").
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
 * What the polite live region below announces. The only feedback an anchor placement used to give
 * was a color change inside a contenteditable, invisible to assistive tech; this is read out for
 * every placement instead.
 */
const liveRegionMessage = ref('')

const editor = useEditor({
  // In anchor mode, `entryExtensions` installs the guard that lets through only the anchor
  // commands below and undo/redo of them — see `isAnchorEdit`. That is what makes "no child entry
  // is destructive" a property of the editor rather than a rule the UI is trusted to follow.
  extensions: entryExtensions({
    anchorMode: props.anchorMode,
    baseContent: props.anchorBaseContent,
  }),
  content: initialDocument,
  editable: !props.disabled,
  editorProps: {
    attributes: {
      // A contenteditable div has no implicit role, so it is spelled out here rather than left to
      // a test id: this is the field a person types into and it should say so.
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': props.label,
      // The anchor-mode modifier keeps the selection visibly painted even once focus leaves the
      // editor for a menu control — see the `::selection` rule below, and `AnchorMenu`'s own
      // `shouldShow` override for the analogous problem on the menu's own side.
      class: props.anchorMode
        ? 'chronicle-document chronicle-document--anchor min-h-32'
        : 'chronicle-document min-h-32',
      ...(props.describedBy ? { 'aria-describedby': props.describedBy } : {}),
      ...anchorMarkupAttr(initialDocument),
    },
    handleClick: (_view: EditorView, pos: number): boolean => {
      // Reopening an anchor this session placed, by clicking its highlighted or struck text — the
      // wording node's own span handles clicks on itself (`AnchorInsertView.vue`); this is only for
      // the marked text beside it, which has no node view of its own to hook a click into. A click
      // on a sealed anchor from an earlier child falls through to ordinary caret placement instead.
      if (!props.anchorMode) return false

      const instance = editor.value
      if (!instance) return false

      const hit = innermostAnchorAt(editableAnchorRanges(instance), pos)
      if (!hit) return false

      openAnchorWording(instance, hit.anchor_id)
      return true
    },
    handleTextInput: (view: EditorView, from: number, to: number, text: string): boolean => {
      // Opening a wording session at the caret. Only an empty selection in anchor mode qualifies;
      // anything else falls through to the guard, which rejects it like any other ordinary edit in
      // this mode.
      if (!props.anchorMode || from !== to) return false

      const instance = editor.value
      if (!instance) return false

      const marksBefore = (view.state.doc.resolve(from).nodeBefore?.marks ?? []).map((mark) =>
        mark.toJSON(),
      ) as DocMark[]
      const pairWith = pairableAnchorAt(marksBefore, sealedAnchorIdsOf(instance))

      // Pairing appends to the anchor's existing node (or creates its first one) rather than
      // inserting a fresh node under the same id — see `openAnchorWording`'s own note on why a
      // second call site inserting blindly used to be able to produce two nodes sharing one id.
      return pairWith
        ? openAnchorWording(instance, pairWith, text) !== null
        : openAnchorInsert(instance, from, text) !== null
    },
  },
  onUpdate: ({ editor: instance, transaction }) => {
    const steps = transaction.steps.map((step) => step.toJSON())
    // A document only changes through steps, so no steps means nothing changed and there is
    // nothing to report. Editors emit updates for housekeeping too, and treating one of those as
    // a real edit is what starts a writing session nobody began.
    if (steps.length === 0) return

    const document = instance.getJSON() as EntryDocument

    if (!props.anchorMode) {
      const mapped = mapAnchorSpans(liveAnchorSpans, transaction.mapping)
      for (const affected of anchorsAffectedBy(mapped)) affectedAnchorIds.add(affected.anchor_id)
      liveAnchorSpans = mapped.map(({ anchor_id, quote, from, to }) => ({
        anchor_id,
        quote,
        from,
        to,
      }))
    }

    if (collectAnchors(document).length > 0) {
      instance.view.dom.setAttribute('data-anchor-markup', ANCHOR_MARKUP_MODE)
    } else {
      instance.view.dom.removeAttribute('data-anchor-markup')
    }

    if (props.anchorMode) {
      const announcement = readAnchorAnnouncement(transaction)
      if (announcement) liveRegionMessage.value = announcement.message
    }

    emit('change', {
      content: JSON.stringify(document),
      title: emittedTitle(),
      steps,
      insertedText: insertedTextOf(transaction),
      // Judged by what the document says before and after, not by which steps did it. A heading,
      // a list, or an alignment leaves every word in place while producing steps that look
      // nothing like a mark's — and so, by the same measure, does every anchor command: the
      // non-destructive invariant means `sameContent` alone can't tell one from real formatting, so
      // an anchor command is excluded explicitly rather than misread as one.
      isFormatting:
        sameContent(transaction.before.toJSON() as EntryDocument, document) &&
        !isAnchorCommand(transaction),
      isAnchorOp: readAnchorTick(transaction),
      anchorIds: props.anchorMode
        ? sessionAnchorIdsIn(sealedAnchorIdsOf(instance), document)
        : undefined,
      affectedAnchorIds: props.anchorMode ? undefined : [...affectedAnchorIds],
    })

    void nextTick(() => media.applyTo(instance.view.dom))
  },
  onCreate: ({ editor: instance }) => {
    if (!props.anchorMode) liveAnchorSpans = anchorSpans(instance.state.doc)
    void media.applyTo(instance.view.dom)
  },
})

// The second argument suppresses an update event. Whether a document may be edited is not a change
// to the document, and TipTap emits one by default.
watch(
  () => props.disabled,
  (disabled) => editor.value?.setEditable(!disabled, false),
)

onBeforeUnmount(() => editor.value?.destroy())

/**
 * A title change is content, but it is not an edit to the traced document: it produces no
 * ProseMirror steps, so the authoring trace and the tick policy see nothing of it (see
 * `draftsStore.recordChange`). That is the deal the title is held to — a coarser record than the
 * body's, its history being the value at each save point rather than a keystroke-level chain.
 *
 * `affectedAnchorIds` is carried through unchanged rather than omitted: it is the session's running
 * total, and a reader that treats a missing list as an empty one would have this change clear
 * warnings the body's edits had earned.
 */
function handleTitleInput(event: Event): void {
  titleText.value = (event.target as HTMLInputElement).value

  const instance = editor.value
  if (!instance) return

  emit('change', {
    content: JSON.stringify(instance.getJSON() as EntryDocument),
    title: emittedTitle(),
    steps: [],
    insertedText: '',
    isFormatting: false,
    isAnchorOp: false,
    affectedAnchorIds: [...affectedAnchorIds],
  })
}

/**
 * Enter and Tab both leave the title for the body.
 *
 * Enter because a title is one line — and because every composer around this is a `<form>`, where
 * the browser's own answer to Enter in a text field is to submit it, saving the entry from the
 * title field. Tab because the toolbar sits between the two and belongs to the body: moving on from
 * a title means the body, not eleven formatting buttons. Neither is trapped — Shift+Tab from the
 * body reaches the toolbar, and Shift+Tab again the title.
 */
function focusBody(): void {
  // The view's own focus rather than `commands.focus()`, which defers to the next animation frame:
  // a character typed within ~16ms of Tab would land back in the title field.
  editor.value?.view.focus()
}

/**
 * The text a change added, for the tick policy alone: it only ever asks whether a sentence just
 * finished. The steps remain the authoritative record of what happened.
 *
 * An anchor-mode wording keystroke (`updateAnchorInsertText`) carries its current text as meta
 * instead of a step slice — it's an attribute change on an atom, not a text-insertion step this
 * loop can read — so that's checked first. `evaluateTick`'s punctuation check only ever looks at the
 * trailing character, so the box's current full text works exactly the same as a true delta would.
 */
function insertedTextOf(transaction: Transaction): string {
  const wordingText = readAnchorWordingText(transaction)
  if (wordingText !== null) return wordingText

  let inserted = ''

  for (const step of transaction.steps) {
    const slice = (
      step as {
        slice?: {
          content: {
            size: number
            textBetween: (from: number, to: number, separator?: string) => string
          }
        }
      }
    ).slice
    if (slice) inserted += slice.content.textBetween(0, slice.content.size, '')
  }

  return inserted
}

/**
 * `AnchorMenu`'s one entry point back into the editor. The range is read explicitly rather than
 * left to `markAnchor`'s own default, because the button that calls this lives in a menu whose
 * own controls can hold focus — see `anchorCommands.ts`'s note on why the range is an explicit,
 * optional parameter there. Opens an existing anchor's wording box rather than marking a new one
 * when the selection overlaps one at all — see `markAnchor`.
 */
function handleAnchorMark(kind: AnchorKind): void {
  const instance = editor.value
  if (!instance) return

  const { from, to } = instance.state.selection
  markAnchor(instance, kind, { from, to })
}

const linkOpen = ref(false)
const linkUrl = ref('')

/** One icon button in the toolbar. `active` is omitted for commands that are not a state to be in. */
interface ToolbarAction {
  label: string
  icon: LucideIcon
  active?: boolean
  enabled?: boolean
  run: () => void
}

/**
 * The toolbar, as data, grouped the way the buttons are laid out.
 *
 * Every one of these is already installed — StarterKit ships them and they have always worked from
 * the keyboard. Buttons are the only part that was missing, so this exposes what the editor can do
 * rather than adding to it. Heading levels live in the text-style select below, not here: a select
 * is a more natural fit for "pick one of several block types," and it is where a future block type
 * (a code block, say) would be added rather than growing this button row.
 *
 * Strikethrough is included: it is ordinary formatting here, distinct from an anchor-op strike
 * (a child entry retracting part of its parent) by its own presentation, not by being withheld
 * from the toolbar. See PRODUCT.md, "Making anchor ops unmistakable".
 */
interface ToolbarGroups {
  history: ToolbarAction[]
  marks: ToolbarAction[]
  lists: ToolbarAction[]
  link: ToolbarAction[]
}

const toolbarGroups = computed<ToolbarGroups>(() => {
  const instance = editor.value
  if (!instance) return { history: [], marks: [], lists: [], link: [] }

  const chain = () => instance.chain().focus()

  return {
    history: [
      {
        label: 'Undo',
        icon: Undo2,
        enabled: instance.can().undo(),
        run: () => chain().undo().run(),
      },
      {
        label: 'Redo',
        icon: Redo2,
        enabled: instance.can().redo(),
        run: () => chain().redo().run(),
      },
    ],
    marks: [
      {
        label: 'Bold',
        icon: Bold,
        active: instance.isActive('bold'),
        run: () => chain().toggleBold().run(),
      },
      {
        label: 'Italic',
        icon: Italic,
        active: instance.isActive('italic'),
        run: () => chain().toggleItalic().run(),
      },
      {
        label: 'Underline',
        icon: Underline,
        active: instance.isActive('underline'),
        run: () => chain().toggleUnderline().run(),
      },
      {
        label: 'Strikethrough',
        icon: Strikethrough,
        active: instance.isActive('strike'),
        run: () => chain().toggleStrike().run(),
      },
    ],
    lists: [
      {
        label: 'List',
        icon: List,
        active: instance.isActive('bulletList'),
        run: () => chain().toggleBulletList().run(),
      },
      {
        label: 'Numbered',
        icon: ListOrdered,
        active: instance.isActive('orderedList'),
        run: () => chain().toggleOrderedList().run(),
      },
      {
        label: 'Quote',
        icon: Quote,
        active: instance.isActive('blockquote'),
        run: () => chain().toggleBlockquote().run(),
      },
    ],
    link: [{ label: 'Link', icon: LinkIcon, active: linkOpen.value, run: openLink }],
  }
})

/**
 * The block type the cursor currently sits in, for the text-style select below. Read-only outside
 * of `setTextStyle`: a `<select>` here is a view onto editor state, not state of its own.
 */
const textStyleValue = computed(() => {
  const instance = editor.value
  if (!instance) return 'paragraph'
  if (instance.isActive('heading', { level: 2 })) return 'heading'
  if (instance.isActive('heading', { level: 3 })) return 'subheading'
  return 'paragraph'
})

function setTextStyle(event: Event): void {
  const instance = editor.value
  if (!instance) return

  const chain = instance.chain().focus()
  switch ((event.target as HTMLSelectElement).value) {
    case 'heading':
      chain.setHeading({ level: 2 }).run()
      break
    case 'subheading':
      chain.setHeading({ level: 3 }).run()
      break
    default:
      chain.setParagraph().run()
  }
}

/**
 * Rarely-reached actions live behind one "More" toggle rather than in the button row, which is
 * where a future addition (dates, mentions, whatever comes next) should go too — see PRODUCT.md.
 * A disclosure, not a `menu`/`menuitem` widget: those roles promise arrow-key navigation this
 * doesn't implement, so plain buttons in a revealed panel are the honest a11y choice.
 */
const moreOpen = ref(false)
const moreToggle = ref<HTMLButtonElement | null>(null)
const morePanel = ref<HTMLElement | null>(null)

function toggleMore(): void {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) linkOpen.value = false
}

function closeMore(returnFocus: boolean): void {
  moreOpen.value = false
  if (returnFocus) moreToggle.value?.focus()
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!moreOpen.value) return
  const target = event.target as Node
  if (moreToggle.value?.contains(target) || morePanel.value?.contains(target)) return
  moreOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown))

function clearFormatting(): void {
  editor.value?.chain().focus().unsetAllMarks().clearNodes().run()
  closeMore(false)
}

function triggerAddImage(): void {
  fileInput.value?.click()
  closeMore(false)
}

/** Seeded from the link under the cursor, so clicking Link on an existing one edits it. */
function openLink(): void {
  if (linkOpen.value) {
    linkOpen.value = false
    return
  }

  linkUrl.value = (editor.value?.getAttributes('link').href as string | undefined) ?? ''
  linkOpen.value = true
  moreOpen.value = false
}

/**
 * Applies to the whole link when the caret merely sits inside one, which is what a reader means by
 * "change this link". An empty address removes it instead, so the field doubles as the way out.
 * The href itself is left to the Link extension, which rejects protocols it does not allow.
 */
function applyLink(): void {
  const href = linkUrl.value.trim()
  const chain = editor.value?.chain().focus().extendMarkRange('link')
  if (!chain) return

  if (href) {
    chain.setLink({ href }).run()
  } else {
    chain.unsetLink().run()
  }

  linkOpen.value = false
}

async function handleFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  attachError.value = null

  try {
    const mediaRef = await media.store(file)
    // The node carries the id; the src is filled in afterwards from an object URL and never
    // becomes part of the document.
    editor.value
      ?.chain()
      .focus()
      .insertContent({ type: MEDIA_NODE, attrs: { mediaRef, alt: file.name } })
      .run()
  } catch (error) {
    attachError.value = toErrorMessage(error, 'Could not attach that image')
  }
}

defineExpose({
  focus: () => editor.value?.commands.focus(),
  clear: () => editor.value?.commands.clearContent(true),
})
</script>

<template>
  <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)]">
    <!--
      Its own field, above the toolbar rather than inside the editing surface, because none of the
      toolbar applies to it: a title is one line of plain text, and an ordinary `<input>` is the one
      thing no formatting command, markdown shortcut, or paste can turn into something else.

      Editable only when the title can actually change here. A `readonly` input still announces as a
      textbox and still looks like somewhere to type, which is the confusion the static branch below
      exists to avoid — for a document being merely displayed, or anchor mode, where nothing in the
      parent's document may change.
    -->
    <div
      v-if="withTitle && !disabled && !anchorMode"
      class="border-b border-[var(--color-border)] px-3 py-2"
    >
      <label :for="`${label}-title`" class="sr-only">Title</label>
      <input
        :id="`${label}-title`"
        type="text"
        class="w-full rounded bg-transparent text-xl font-bold placeholder:font-normal placeholder:text-[var(--color-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
        placeholder="Title"
        :value="titleText"
        @input="handleTitleInput"
        @keydown.enter.prevent="focusBody"
        @keydown.tab.exact.prevent="focusBody"
      />
    </div>
    <div
      v-else-if="withTitle && titleText"
      class="border-b border-[var(--color-border)] px-3 py-2 text-xl font-bold"
    >
      {{ titleText }}
    </div>

    <AnchorMenu v-if="editor && anchorMode" :editor="editor" @mark="handleAnchorMark" />

    <!--
      A polite live region: the only feedback an anchor placement used to give was a color change
      inside a contenteditable, which assistive tech cannot see at all. Always in the DOM, even
      outside anchor mode, since a live region has to exist before its first update to be announced
      reliably — an empty one the rest of the time costs nothing.
    -->
    <p v-if="anchorMode" class="sr-only" role="status" aria-live="polite">
      {{ liveRegionMessage }}
    </p>

    <div
      v-if="editor && !anchorMode"
      class="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-2 py-1"
      role="toolbar"
      :aria-label="`${label} formatting`"
    >
      <!--
        `mousedown.prevent` keeps the caret in the document. Without it the button takes focus on
        mousedown, and in a real browser the keystrokes after a click land on the button rather than
        in the text: Enter re-presses it and the words go nowhere. Restoring focus inside the click
        handler is too late to prevent that.

        Neither test runner reproduces it — both synthesize the click in a way that leaves focus
        where the handler puts it — so this one is held by the driven-browser check in
        `DocumentEditor` rather than by a spec.

        Every button below is icon-only: the visible label is gone, but `aria-label` keeps the
        accessible name exactly what it was, so `getByRole('button', { name: 'Bold' })` and friends
        still find these the same way. `title` is only for the mouse tooltip; it never wins over
        `aria-label` when a screen reader computes the name.
      -->
      <button
        v-for="action in toolbarGroups.history"
        :key="action.label"
        type="button"
        class="rounded p-1.5 hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
        :aria-label="action.label"
        :title="action.label"
        :disabled="disabled || action.enabled === false"
        @mousedown.prevent
        @click="action.run"
      >
        <component :is="action.icon" class="h-4 w-4" aria-hidden="true" />
      </button>

      <span aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />

      <!--
        A select, not two more toggle buttons: only one block type ever applies at once, and this is
        where a future one (a code block, say) gets added without the button row growing again.
      -->
      <label :for="`${label}-text-style`" class="sr-only">Text style</label>
      <select
        :id="`${label}-text-style`"
        class="rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        :value="textStyleValue"
        :disabled="disabled"
        @change="setTextStyle"
      >
        <option value="paragraph">Normal text</option>
        <option value="heading">Heading</option>
        <option value="subheading">Subheading</option>
      </select>

      <span aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />

      <template
        v-for="(group, index) in [toolbarGroups.marks, toolbarGroups.lists, toolbarGroups.link]"
        :key="index"
      >
        <span v-if="index > 0" aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />
        <button
          v-for="action in group"
          :key="action.label"
          type="button"
          class="rounded p-1.5 hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
          :class="{ 'bg-[var(--color-surface)] text-[var(--color-accent)]': action.active }"
          :aria-pressed="action.active"
          :aria-label="action.label"
          :title="action.label"
          :disabled="disabled || action.enabled === false"
          @mousedown.prevent
          @click="action.run"
        >
          <component :is="action.icon" class="h-4 w-4" aria-hidden="true" />
        </button>
      </template>

      <span aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />

      <!--
        The overflow menu: rarely-reached actions today, and the place a future addition to this
        toolbar belongs instead of a new button crowding the row above. A disclosure, not a
        `menu`/`menuitem` widget — those roles promise arrow-key navigation this doesn't implement,
        so plain, independently-tabbable buttons in a revealed panel are the honest a11y choice.
      -->
      <div class="relative">
        <button
          ref="moreToggle"
          type="button"
          class="rounded p-1.5 hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
          :class="{ 'bg-[var(--color-surface)] text-[var(--color-accent)]': moreOpen }"
          :aria-expanded="moreOpen"
          :aria-controls="`${label}-more-menu`"
          aria-label="More formatting actions"
          title="More"
          :disabled="disabled"
          @mousedown.prevent
          @click="toggleMore"
          @keydown.escape="closeMore(true)"
        >
          <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
        </button>
        <div
          v-if="moreOpen"
          :id="`${label}-more-menu`"
          ref="morePanel"
          class="absolute left-0 top-full z-10 mt-1 min-w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-md"
          @keydown.escape="closeMore(true)"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-bg-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="disabled"
            @mousedown.prevent
            @click="clearFormatting"
          >
            <Eraser class="h-4 w-4" aria-hidden="true" />
            Clear formatting
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-bg-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="disabled"
            @mousedown.prevent
            @click="triggerAddImage"
          >
            <Image class="h-4 w-4" aria-hidden="true" />
            Add image
          </button>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="sr-only"
        aria-label="Attach an image"
        @change="handleFiles"
      />
    </div>

    <!--
      A field rather than a browser prompt: it can be labelled, reached by keyboard, and tested
      like the rest of the toolbar.
    -->
    <div
      v-if="linkOpen"
      class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-2 py-2"
    >
      <label for="editor-link-url" class="text-sm">Link address</label>
      <input
        id="editor-link-url"
        v-model="linkUrl"
        type="url"
        placeholder="https://"
        class="min-w-48 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
        :disabled="disabled"
        @keyup.enter="applyLink"
      />
      <button
        type="button"
        class="rounded px-2 py-1 text-sm hover:bg-[var(--color-surface)]"
        :disabled="disabled"
        @click="applyLink"
      >
        Apply link
      </button>
    </div>

    <p v-if="attachError" class="px-3 pt-2 text-sm text-[var(--color-error)]" role="alert">
      {{ attachError }}
    </p>

    <EditorContent :editor="editor" class="px-3 py-2 text-sm leading-relaxed" />
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
  padding: 0 0.05rem;
}

:deep(.chronicle-document .chronicle-anchor[data-anchor-kind='comment']) {
  background-color: color-mix(in srgb, var(--color-anchor-comment) 45%, transparent);
}

:deep(.chronicle-document .chronicle-anchor[data-anchor-kind='strike']) {
  background-color: color-mix(in srgb, var(--color-anchor-strike) 45%, transparent);
  text-decoration: line-through;
}

:deep(.chronicle-document .chronicle-anchor-insert) {
  text-decoration: none;
  /*
    A fixed visual gap ahead of the wording, independent of whatever whitespace the marked passage
    behind it does or doesn't have — `addAnchorMark` (`anchorCommands.ts`) trims a placed anchor's
    own span down to real characters, so there's never a space character here to lean on for
    spacing. Applied to the `<ins>` wrapper rather than the wording span inside it, so it covers the
    open input box too, not just the closed rendering.
  */
  margin-inline-start: 0.25em;
}

/*
  Inline presentation — active (`ANCHOR_MARKUP_MODE` above is 'inline'). Wording trails straight
  after the marked passage in normal flow, like ordinary text, with no separate glyph marking where
  it starts — the type styling below is what reads as "this is proposed wording, not the original".
  A caret glyph was tried here too and taken back out: pointing up reads fine when the wording is
  actually above (see the dormant presentation below), but pointing at nothing when it's sitting
  right next to the wording on the same line just looks like a stray mark.
*/
:deep(.chronicle-document .chronicle-anchor-wording) {
  font-size: 0.82em;
  color: var(--color-anchor-insert);
  font-style: italic;
}

/*
  Interlinear presentation — dormant. `ANCHOR_MARKUP_MODE` above is hardcoded to 'inline', so
  `data-anchor-markup` never actually reaches 'interlinear' and none of the rules below ever match.
  Kept rather than deleted for whenever there's a real display-setting to choose between the two
  presentations (PRODUCT.md, "Making anchor ops unmistakable": "Inline vs. interlinear wording
  placement is a second thing that same setting would choose").

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
  "Making anchor ops unmistakable") is worth rechecking against too — italic-plus-color as "this is
  wording, not original text" gets weaker the more the original text is itself colored.

:deep(.chronicle-document .chronicle-anchor-insert) {
  position: relative;
}

:deep(.chronicle-document .chronicle-anchor-insert::before) {
  content: '⌃';
  color: var(--color-anchor-caret);
}

:deep(.chronicle-document .chronicle-anchor-wording),
:deep(.chronicle-document .chronicle-anchor-insert-box) {
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
  `outline-none` at rest so a mouse click never shows one, matching the formatting toolbar's own
  buttons above.
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
  The open state of an `anchorInsert` node view (`AnchorInsertView.vue`): a bordered, auto-sizing
  input plus a checkmark, sitting inline right after the caret glyph. Styled to visibly read as a
  text box the moment it appears — including its empty placeholder state — rather than something
  that only looks like one after it already has content.
*/
:deep(.chronicle-anchor-insert-box) {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  z-index: 1;
}

:deep(.chronicle-anchor-insert-input) {
  border: 1px solid var(--color-anchor-insert);
  border-radius: 0.25rem;
  background-color: var(--color-surface);
  color: var(--color-anchor-insert);
  padding: 0 0.25rem;
  font-size: 0.82em;
  font-style: italic;
  outline: none;
}

:deep(.chronicle-anchor-insert-accept) {
  color: var(--color-anchor-insert);
  flex-shrink: 0;
}

/*
  Remove is shown for every open anchor; the Highlight/Strike toggles only for one with a mark to
  switch — a bare insertion has no kind. `--active` marks whichever kind the anchor currently
  carries, echoing the same two colors `.chronicle-anchor[data-anchor-kind]` above renders on the
  passage itself.
*/
:deep(.chronicle-anchor-insert-kind),
:deep(.chronicle-anchor-insert-remove) {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-text-muted);
  border-radius: 0.2rem;
  padding: 0.05rem;
}

:deep(.chronicle-anchor-insert-kind:hover),
:deep(.chronicle-anchor-insert-remove:hover) {
  background-color: var(--color-bg-muted);
  color: var(--color-text);
}

:deep(.chronicle-anchor-insert-kind--active) {
  color: var(--color-anchor-insert);
}

/*
  A placed anchor this session may still edit is itself clickable — see PRODUCT.md §4.4,
  "Interacting with an anchor already placed" — so its wording reads as something to act on rather
  than plain text, without disturbing the italic/color styling above that marks it as proposed
  wording in the first place.
*/
:deep(.chronicle-anchor-wording--editable) {
  cursor: pointer;
  border-radius: 0.15rem;
}

:deep(.chronicle-anchor-wording--editable:hover) {
  text-decoration: underline;
}
</style>
