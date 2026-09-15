<script setup lang="ts">
/**
 * The wording a child entry proposes at a point in the parent's document, in its own Vue node view
 * so there is one mechanism for typing wording whether it pairs with a highlight, a strike, or
 * stands alone.
 *
 * Committed, it renders the same markup `AnchorInsert.renderHTML` (`extensions.ts`) produces, so the
 * live editor and the read-only view agree on shape. Open — `editor.storage.anchorInsert` names this
 * node's `anchorId` as the one being edited — it becomes a bordered, auto-sizing input plus a
 * checkmark, sitting inline right after the marked passage (`DocumentEditor.vue` has the CSS for
 * both this presentation and the dormant floated-with-a-caret-glyph one). The node itself stays an
 * atom: typing happens in a real `<input>`, never inside ProseMirror, so there is no in-document
 * text-editing to guard against and no IME trouble.
 *
 * `contenteditable="false"` on the wrapper is load-bearing, not decorative: a native `<input>`
 * nested inside an ancestor `contenteditable` region is a known rough edge across browsers — the
 * surrounding contenteditable's own selection/caret management can intercept focus and keystrokes
 * meant for the nested control, leaving it visible but untypeable. Marking this node's own DOM
 * subtree as not editable tells the browser to leave it alone and manage the input normally.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { Check } from '@lucide/vue'
import {
  cancelAnchorInsert,
  commitAnchorInsert,
  updateAnchorInsertText,
  type AnchorInsertStorage,
} from '@/editor/anchorCommands'
import { ANCHOR_INSERT_NODE } from '@/domain/entryDocument'

const props = defineProps(nodeViewProps)

const storage = computed(
  () =>
    (props.editor.storage as unknown as Record<string, AnchorInsertStorage>)[ANCHOR_INSERT_NODE],
)
const anchorId = computed(() => props.node.attrs.anchorId as string)
const text = computed(() => (props.node.attrs.text as string | undefined) ?? '')
const isOpen = computed(() => storage.value.openAnchorId.value === anchorId.value)

const inputRef = ref<HTMLInputElement | null>(null)

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

/**
 * Clicking away commits too, same as Enter or the checkmark — an implicit save rather than a state
 * a person can get stuck in. Guarded on `isOpen`: committing or cancelling already closes this box
 * (and removes the input from the DOM), so a blur that fires afterward as part of that same
 * teardown must not commit a second time against a position the first commit already resolved.
 */
function handleBlur(): void {
  if (!isOpen.value) return
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
    <span v-if="isOpen" class="chronicle-anchor-insert-box">
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
        @blur="handleBlur"
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
    </span>
    <span v-else class="chronicle-anchor-wording">{{ text }}</span>
  </NodeViewWrapper>
</template>
