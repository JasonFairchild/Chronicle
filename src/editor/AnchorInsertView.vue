<script setup lang="ts">
/**
 * The wording a child entry proposes at a point in the parent's document, in its own Vue node view
 * so there is one mechanism for typing wording whether it pairs with a highlight, a strike, or
 * stands alone.
 *
 * Committed, it renders the same markup `AnchorInsert.renderHTML` (`extensions.ts`) produces, so the
 * live editor and the read-only view agree on shape. Open — `editor.storage.anchorInsert` names this
 * node's `anchorId` as the one being edited — it becomes a bordered, auto-sizing input, an Accept
 * checkmark, Remove, and — for an anchor that has a mark to switch — Highlight/Strike toggles,
 * sitting inline right after the marked passage (`DocumentEditor.vue` has the CSS for both this
 * presentation and the dormant floated-with-a-caret-glyph one). The node itself stays an atom:
 * typing happens in a real `<input>`, never inside ProseMirror, so there is no in-document
 * text-editing to guard against and no IME trouble.
 *
 * Closed, an anchor this session may still edit (`isEditableAnchor`) is itself clickable, reopening
 * this same box with its current wording already in the input — see PRODUCT.md §4.4, "Interacting
 * with an anchor already placed". A sealed anchor from an earlier, already-sealed child renders the
 * same markup but is not clickable: only the anchor that placed it may change it.
 *
 * `contenteditable="false"` on the wrapper is load-bearing, not decorative: a native `<input>`
 * nested inside an ancestor `contenteditable` region is a known rough edge across browsers — the
 * surrounding contenteditable's own selection/caret management can intercept focus and keystrokes
 * meant for the nested control, leaving it visible but untypeable. Marking this node's own DOM
 * subtree as not editable tells the browser to leave it alone and manage the input normally.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { Check, Highlighter, Strikethrough, Trash2 } from '@lucide/vue'
import {
  cancelAnchorInsert,
  commitAnchorInsert,
  editableAnchorRanges,
  isEditableAnchor,
  openAnchorWording,
  removeAnchor,
  setAnchorKind,
  updateAnchorInsertText,
  type AnchorInsertStorage,
} from '@/editor/anchorCommands'
import { ANCHOR_INSERT_NODE } from '@/domain/entryDocument'
import type { AnchorKind } from '@/types/entry'

const props = defineProps(nodeViewProps)

const storage = computed(
  () =>
    (props.editor.storage as unknown as Record<string, AnchorInsertStorage>)[ANCHOR_INSERT_NODE],
)
const anchorId = computed(() => props.node.attrs.anchorId as string)
const text = computed(() => (props.node.attrs.text as string | undefined) ?? '')
const isOpen = computed(() => storage.value.openAnchorId.value === anchorId.value)

/** Whether this session placed the anchor and may still change or remove it. */
const editable = computed(() => isEditableAnchor(props.editor, anchorId.value))

/**
 * The anchor's current kind, or null when it has no mark at all — a bare insertion standing alone.
 * The Highlight/Strike toggles only make sense for the former: a bare insertion has no kind to
 * switch. Remove applies either way — `removeAnchor` already strips whichever pieces an anchor
 * actually has, mark and node alike, so it needs no kind to act on.
 */
const kind = computed<AnchorKind | null>(
  () =>
    editableAnchorRanges(props.editor).find((range) => range.anchor_id === anchorId.value)?.kind ??
    null,
)

const inputRef = ref<HTMLInputElement | null>(null)
const boxRef = ref<HTMLElement | null>(null)

watch(
  isOpen,
  (open) => {
    if (open) void nextTick(() => inputRef.value?.focus())
  },
  { immediate: true },
)

/**
 * `getPos` can report `undefined` for a node view mid-teardown — nothing to update in that case,
 * so every handler below is a no-op rather than dispatching a transaction against a stale position.
 */
function handleInput(event: Event): void {
  const pos = props.getPos()
  if (pos === undefined) return
  updateAnchorInsertText(props.editor, pos, (event.target as HTMLInputElement).value)
}

function commit(): void {
  const pos = props.getPos()
  if (pos === undefined) return
  commitAnchorInsert(props.editor, pos, text.value)
}

function cancel(): void {
  const pos = props.getPos()
  if (pos === undefined) return
  cancelAnchorInsert(props.editor, pos)
}

function setKind(next: AnchorKind): void {
  setAnchorKind(props.editor, anchorId.value, next)
}

function remove(): void {
  removeAnchor(props.editor, anchorId.value)
}

/** Reopens this anchor's box — the closed wording span's own click handler. */
function openForEdit(): void {
  if (!editable.value) return
  openAnchorWording(props.editor, anchorId.value)
}

/**
 * Ctrl+Alt+H / Ctrl+Alt+S while the input has focus. The document's own keyboard shortcuts
 * (`extensions.ts`) are bound to ProseMirror's view and never see a keystroke inside this plain
 * `<input>`, which sits outside the contenteditable DOM entirely — so the same shortcut needs its
 * own binding here to reach an anchor whose box is already open.
 */
function handleInputKeydown(event: KeyboardEvent): void {
  if (!event.ctrlKey || !event.altKey) return
  if (event.key.toLowerCase() === 'h') {
    event.preventDefault()
    setKind('comment')
  } else if (event.key.toLowerCase() === 's') {
    event.preventDefault()
    setKind('strike')
  }
}

/**
 * Commits when focus leaves the box entirely — clicking away, or tabbing past the last control —
 * same as Enter or the checkmark: an implicit save rather than a state a person can get stuck in.
 * Checked against the whole box, not just the input, so Tab can reach the Highlight/Strike/Remove
 * buttons beside it without closing the box first; each of those buttons also takes mousedown with
 * `.prevent`, so a mouse click never blurs the input in the first place. Guarded on `isOpen`:
 * committing, cancelling, or removing already closes this box (and, for remove, tears down the node
 * entirely), so a blur that fires afterward as part of that same teardown must not commit a second
 * time against a position the first action already resolved.
 */
function handleFocusOut(event: FocusEvent): void {
  if (!isOpen.value) return
  const next = event.relatedTarget as Node | null
  if (next && boxRef.value?.contains(next)) return
  commit()
}
</script>

<template>
  <NodeViewWrapper
    as="ins"
    class="chronicle-anchor-insert"
    contenteditable="false"
    :data-anchor-id="anchorId"
  >
    <span v-if="isOpen" ref="boxRef" class="chronicle-anchor-insert-box" @focusout="handleFocusOut">
      <button
        v-if="kind"
        type="button"
        class="chronicle-anchor-insert-kind"
        :class="{ 'chronicle-anchor-insert-kind--active': kind === 'comment' }"
        :aria-pressed="kind === 'comment'"
        aria-label="Highlight"
        title="Highlight (Ctrl+Alt+H)"
        @mousedown.prevent
        @click="setKind('comment')"
      >
        <Highlighter class="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        v-if="kind"
        type="button"
        class="chronicle-anchor-insert-kind"
        :class="{ 'chronicle-anchor-insert-kind--active': kind === 'strike' }"
        :aria-pressed="kind === 'strike'"
        aria-label="Strike"
        title="Strike (Ctrl+Alt+S)"
        @mousedown.prevent
        @click="setKind('strike')"
      >
        <Strikethrough class="h-3 w-3" aria-hidden="true" />
      </button>
      <input
        ref="inputRef"
        type="text"
        :value="text"
        :size="Math.max(text.length + 1, 12)"
        placeholder="Add wording…"
        class="chronicle-anchor-insert-input"
        aria-label="Wording"
        @input="handleInput"
        @keydown.enter.prevent="commit"
        @keydown.escape.prevent="cancel"
        @keydown="handleInputKeydown"
      />
      <button
        type="button"
        class="chronicle-anchor-insert-accept"
        aria-label="Accept wording"
        @mousedown.prevent
        @click="commit"
      >
        <Check class="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="chronicle-anchor-insert-remove"
        aria-label="Remove anchor"
        title="Remove"
        @mousedown.prevent
        @click="remove"
      >
        <Trash2 class="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
    <span
      v-else
      class="chronicle-anchor-wording"
      :class="{ 'chronicle-anchor-wording--editable': editable }"
      :role="editable ? 'button' : undefined"
      :tabindex="editable ? 0 : undefined"
      :aria-label="editable ? 'Edit wording' : undefined"
      @click="openForEdit"
      @keydown.enter="openForEdit"
      @keydown.space.prevent="openForEdit"
      >{{ text }}</span
    >
  </NodeViewWrapper>
</template>
