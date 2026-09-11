<script lang="ts">
/** One editor change, reduced to what the draft buffer and the tick policy need. */
export interface EditorChange {
  /** The document as it now stands, serialized the way an entry stores it. */
  content: string
  /** Serialized ProseMirror steps for this change, in order. */
  steps: unknown[]
  /** Text this change added. Empty for a deletion or a formatting change. */
  insertedText: string
  isFormatting: boolean
  /**
   * Anchors placed since this editor mounted, in `anchor-mode` only. Derived by diffing against
   * the document this editor started from, so undoing an anchor drops back out on its own —
   * nothing here has to notice an undo and subtract it.
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Transaction } from '@tiptap/pm/state'
import { addedAnchorIds } from '@/domain/anchors'
import { anchorsAffectedBy } from '@/domain/anchorWarnings'
import { useMedia } from '@/composables/useMedia'
import {
  emptyDocument,
  ensureTitle,
  parseDocument,
  sameContent,
  MEDIA_NODE,
  type EntryDocument,
} from '@/domain/entryDocument'
import {
  addAnchorInsert,
  addAnchorMark,
  anchorSpans,
  mapAnchorSpans,
  type AnchorSpan,
} from '@/editor/anchorCommands'
import { entryExtensions } from '@/editor/extensions'

const props = withDefaults(
  defineProps<{
    /** Accessible name for the editing surface. */
    label: string
    /** Seed content, serialized. Read once, on mount: the editor owns the document after that. */
    content?: string
    /** Root entries get a title node; children and revisions do not. */
    withTitle?: boolean
    disabled?: boolean
    /**
     * The other creation experience (ENTRY_MODEL.md, "Two creation experiences, kept separate").
     * Surrounding text becomes unreachable — only the anchor toolbar below can change the
     * document — and the ordinary formatting toolbar is replaced by it.
     */
    anchorMode?: boolean
  }>(),
  { content: '', withTitle: false, disabled: false, anchorMode: false },
)

const emit = defineEmits<{
  change: [change: EditorChange]
}>()

const media = useMedia()
const fileInput = ref<HTMLInputElement | null>(null)
const attachError = ref<string | null>(null)

/**
 * Seeded once, on mount. A titled editor is guaranteed a title node even when the document it
 * opens has none, or an entry written before the editor existed could never be given a name.
 */
function seedDocument() {
  const doc = props.content ? parseDocument(props.content) : emptyDocument(props.withTitle)
  return props.withTitle ? ensureTitle(doc) : doc
}

// Captured once, so anchor mode can tell "placed this session" apart from "was already there" for
// as long as this editor instance lives — the same document this editor opened, never reassigned.
const initialDocument = seedDocument()

/**
 * The anchors already in the document, moved forward one transaction at a time — text mode only.
 * Reassigned after every edit so the next one resumes tracking from where this one left off,
 * rather than needing to compose every step's `Mapping` since the session began.
 */
let liveAnchorSpans: AnchorSpan[] = []
/** Anchors this session has disturbed so far. Sticky: once flagged, an anchor stays flagged. */
const affectedAnchorIds = new Set<string>()

const editor = useEditor({
  // In anchor mode, `entryExtensions` installs the guard that lets through only the anchor
  // commands below and undo/redo of them — see `isAnchorEdit`. That is what makes "no child entry
  // is destructive" a property of the editor rather than a rule the UI is trusted to follow.
  extensions: entryExtensions({ withTitle: props.withTitle, anchorMode: props.anchorMode }),
  content: initialDocument,
  editable: !props.disabled,
  editorProps: {
    attributes: {
      // A contenteditable div has no implicit role, so it is spelled out here rather than left to
      // a test id: this is the field a person types into and it should say so.
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': props.label,
      class: 'chronicle-document min-h-32 outline-none',
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

    emit('change', {
      content: JSON.stringify(document),
      steps,
      insertedText: insertedTextOf(transaction),
      // Judged by what the document says before and after, not by which steps did it. A heading,
      // a list, or an alignment leaves every word in place while producing steps that look
      // nothing like a mark's.
      isFormatting: sameContent(transaction.before.toJSON() as EntryDocument, document),
      anchorIds: props.anchorMode ? addedAnchorIds(initialDocument, document) : undefined,
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
 * The text a change added, for the tick policy alone: it only ever asks whether a sentence just
 * finished. The steps remain the authoritative record of what happened.
 */
function insertedTextOf(transaction: Transaction): string {
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
 * Anchor mode's whole action set: select then comment or strike, or place the cursor and propose
 * wording. Nothing else is reachable here — see `filterTransaction` above.
 */
const hasSelection = computed(() => Boolean(editor.value && !editor.value.state.selection.empty))
const anchorText = ref('')
/** The strike just placed, if any, so wording typed next pairs with it rather than standing alone. */
const pendingStrikeId = ref<string | null>(null)

function commentSelection(): void {
  if (!editor.value) return
  addAnchorMark(editor.value, 'comment')
  pendingStrikeId.value = null
}

function strikeSelection(): void {
  if (!editor.value) return
  pendingStrikeId.value = addAnchorMark(editor.value, 'strike')
}

function insertWording(): void {
  const text = anchorText.value.trim()
  if (!editor.value || !text) return

  addAnchorInsert(editor.value, text, pendingStrikeId.value ?? undefined)
  anchorText.value = ''
  pendingStrikeId.value = null
}

const linkOpen = ref(false)
const linkUrl = ref('')

/** One button in the toolbar. `active` is omitted for commands that are not a state to be in. */
interface ToolbarAction {
  label: string
  active?: boolean
  enabled?: boolean
  run: () => void
}

/**
 * The toolbar, as data.
 *
 * Every one of these is already installed — StarterKit ships them and they have always worked from
 * the keyboard. Buttons are the only part that was missing, so this list exposes what the editor
 * can do rather than adding to it.
 *
 * One deliberate omission. Heading level one is absent because the title node is the document's
 * h1, and a second one in the body would compete with it.
 *
 * Strikethrough is included: it is ordinary formatting here, distinct from an anchor-op strike
 * (a child entry retracting part of its parent) by its own presentation, not by being withheld
 * from the toolbar. See PRODUCT.md, "Making anchor ops unmistakable".
 */
const toolbarGroups = computed<ToolbarAction[][]>(() => {
  const instance = editor.value
  if (!instance) return []

  const chain = () => instance.chain().focus()

  return [
    [
      { label: 'Undo', enabled: instance.can().undo(), run: () => chain().undo().run() },
      { label: 'Redo', enabled: instance.can().redo(), run: () => chain().redo().run() },
    ],
    [
      {
        label: 'Heading',
        active: instance.isActive('heading', { level: 2 }),
        run: () => chain().toggleHeading({ level: 2 }).run(),
      },
      {
        label: 'Subheading',
        active: instance.isActive('heading', { level: 3 }),
        run: () => chain().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      { label: 'Bold', active: instance.isActive('bold'), run: () => chain().toggleBold().run() },
      {
        label: 'Italic',
        active: instance.isActive('italic'),
        run: () => chain().toggleItalic().run(),
      },
      {
        label: 'Underline',
        active: instance.isActive('underline'),
        run: () => chain().toggleUnderline().run(),
      },
      {
        label: 'Strikethrough',
        active: instance.isActive('strike'),
        run: () => chain().toggleStrike().run(),
      },
    ],
    [
      {
        label: 'List',
        active: instance.isActive('bulletList'),
        run: () => chain().toggleBulletList().run(),
      },
      {
        label: 'Numbered',
        active: instance.isActive('orderedList'),
        run: () => chain().toggleOrderedList().run(),
      },
      {
        label: 'Quote',
        active: instance.isActive('blockquote'),
        run: () => chain().toggleBlockquote().run(),
      },
    ],
    [
      { label: 'Link', active: linkOpen.value, run: openLink },
      // Marks and block types both, so one button answers "get this back to plain".
      { label: 'Clear formatting', run: () => chain().unsetAllMarks().clearNodes().run() },
      { label: 'Add image', run: () => fileInput.value?.click() },
    ],
  ]
})

/** Seeded from the link under the cursor, so clicking Link on an existing one edits it. */
function openLink(): void {
  if (linkOpen.value) {
    linkOpen.value = false
    return
  }

  linkUrl.value = (editor.value?.getAttributes('link').href as string | undefined) ?? ''
  linkOpen.value = true
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
    attachError.value = error instanceof Error ? error.message : 'Could not attach that image'
  }
}

defineExpose({
  focus: () => editor.value?.commands.focus(),
  clear: () => editor.value?.commands.clearContent(true),
})
</script>

<template>
  <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)]">
    <div
      v-if="editor && anchorMode"
      class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-2 py-1.5"
      role="toolbar"
      :aria-label="`${label} anchor actions`"
    >
      <button
        type="button"
        class="rounded px-2 py-1 text-sm hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled || !hasSelection"
        @mousedown.prevent
        @click="commentSelection"
      >
        Comment on selection
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-sm hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled || !hasSelection"
        @mousedown.prevent
        @click="strikeSelection"
      >
        Strike selection
      </button>

      <span aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />

      <label :for="`${label}-anchor-insert`" class="text-sm text-[var(--color-text-muted)]">
        {{ pendingStrikeId ? 'Replacement wording' : 'Insert wording here' }}
      </label>
      <input
        :id="`${label}-anchor-insert`"
        v-model="anchorText"
        type="text"
        :disabled="disabled || (hasSelection && !pendingStrikeId)"
        class="min-w-40 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        @keyup.enter="insertWording"
      />
      <button
        type="button"
        class="rounded px-2 py-1 text-sm hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled || (hasSelection && !pendingStrikeId) || !anchorText.trim()"
        @mousedown.prevent
        @click="insertWording"
      >
        Insert
      </button>
    </div>

    <div
      v-else-if="editor"
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
      -->
      <template v-for="(group, index) in toolbarGroups" :key="index">
        <span v-if="index > 0" aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />
        <button
          v-for="action in group"
          :key="action.label"
          type="button"
          class="rounded px-2 py-1 text-sm hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
          :class="{ 'bg-[var(--color-surface)] text-[var(--color-accent)]': action.active }"
          :aria-pressed="action.active"
          :disabled="disabled || action.enabled === false"
          @mousedown.prevent
          @click="action.run"
        >
          {{ action.label }}
        </button>
      </template>
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

    <p v-if="attachError" class="px-3 pt-2 text-sm text-red-500" role="alert">{{ attachError }}</p>

    <EditorContent :editor="editor" class="px-3 py-2 text-sm leading-relaxed" />
  </div>
</template>

<style scoped>
/*
  The editor renders ProseMirror's own DOM, so these have to pierce scoping. Sizes and weights
  only — every colour stays on a CSS variable so dark mode is a token swap.
*/
:deep(.chronicle-document h1[data-title]) {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

/*
  The Placeholder extension marks an empty text block `is-empty` and carries the words to show in
  `data-placeholder`; this is only the styling for that. `float: left` plus `height: 0` is the
  extension's own recommended pairing, so the ghost text doesn't add a line the real content never
  had once it's typed over.
*/
:deep(.chronicle-document .is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--color-text-muted);
  pointer-events: none;
}

/* Title's placeholder reads as a hint, not as the heading itself. */
:deep(.chronicle-document h1[data-title].is-empty::before) {
  font-weight: 400;
}

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
  Anchor highlight colours come from the system scheme (main.css) rather than anything stored on
  the mark — see ENTRY_MODEL.md, "Colour". Comment and strike share the mark and differ only by the
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
  color: var(--color-anchor-insert);
  text-decoration: none;
  font-style: italic;
}
</style>
