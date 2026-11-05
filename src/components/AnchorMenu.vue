<script setup lang="ts">
// Anchor mode's controls, as a floating menu built on TipTap's `BubbleMenu`, so positioning and
// show/hide timing come from the library rather than being reinvented here.
//
// Read off the editor's state on every render, never remembered between clicks. Over a selection
// it offers Highlight and Strike; with the caret on an anchor this session placed, that anchor's
// kind pressed, and Remove. A bare insertion has no kind to switch. `applyAnchorKind`
// (`editor/anchorCommands.ts`) decides what a kind button does, which keeps anchors exclusive
// (PRODUCT.md §4.4).
import { Highlighter, type LucideIcon, Strikethrough, Trash2 } from '@lucide/vue'
import { type EditorState, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { computed, ref } from 'vue'

import { applyAnchorKind, ownAnchorAt, removeAnchor } from '@/editor/anchorCommands'
import type { AnchorKind } from '@/types/entry'

const props = defineProps<{
  /** `@tiptap/vue-3`'s, whose state is reactive, so the anchor at the caret stays current. */
  editor: Editor
}>()

/** Mirrors `EditorToolbar`'s `ToolbarAction` shape. */
interface AnchorMenuAction {
  label: string
  icon: LucideIcon
  shortcut: string
  kind: AnchorKind
}

const actions: AnchorMenuAction[] = [
  { label: 'Highlight passage', icon: Highlighter, shortcut: 'Ctrl+Alt+H', kind: 'comment' },
  { label: 'Strike passage', icon: Strikethrough, shortcut: 'Ctrl+Alt+S', kind: 'strike' },
]

/** The session's own anchor at the caret; null over a selection. */
const caretAnchor = computed(() => {
  const { selection } = props.editor.state
  return selection.empty ? ownAnchorAt(props.editor.state, selection.from) : null
})

const group = ref<HTMLElement | null>(null)

/** BubbleMenu makes its own wrapper a Tab stop, an empty one ahead of the buttons inside it. */
function untabWrapper(): void {
  if (group.value?.parentElement) group.value.parentElement.tabIndex = -1
}

function shouldShow({ state }: { state: EditorState }): boolean {
  const { selection } = state
  if (selection.empty) return ownAnchorAt(state, selection.from) !== null
  return selection instanceof TextSelection
}
</script>

<template>
  <!-- A root of its own: BubbleMenu detaches its element while hidden. -->
  <div>
    <BubbleMenu
      :editor="editor"
      :should-show="shouldShow"
      :options="{ placement: 'top', onShow: untabWrapper }"
    >
      <!-- A group, not a toolbar: that role promises arrow keys, and two or three buttons are
           plain Tab stops. -->
      <div
        ref="group"
        class="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-md"
        role="group"
        aria-label="Anchor actions"
      >
        <template v-if="!caretAnchor || caretAnchor.kind">
          <button
            v-for="action in actions"
            :key="action.label"
            type="button"
            class="rounded p-1.5 hover:bg-[var(--color-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
            :class="{
              'bg-[var(--color-bg-muted)] text-[var(--color-accent)]':
                caretAnchor?.kind === action.kind,
            }"
            :aria-label="action.label"
            :aria-keyshortcuts="action.shortcut"
            :aria-pressed="caretAnchor ? caretAnchor.kind === action.kind : undefined"
            :title="`${action.label} (${action.shortcut})`"
            @mousedown.prevent
            @click="applyAnchorKind(editor, action.kind)"
          >
            <component :is="action.icon" class="h-4 w-4" aria-hidden="true" />
          </button>
        </template>
        <button
          v-if="caretAnchor"
          type="button"
          class="rounded p-1.5 hover:bg-[var(--color-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
          aria-label="Remove anchor"
          title="Remove anchor"
          @mousedown.prevent
          @click="removeAnchor(editor, caretAnchor.anchor_id)"
        >
          <Trash2 class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </BubbleMenu>
  </div>
</template>
