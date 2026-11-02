<script setup lang="ts">
// Anchor mode's whole action set, as a floating menu over the current selection. Built on TipTap's
// `BubbleMenu` so positioning and show/hide timing come from the library rather than being
// reinvented here.
//
// Actions are derived from the **selection** on every render, never remembered between clicks: a
// range of ordinary text offers the two mark actions; a selected media node offers none yet
// (PRODUCT.md §6, image anchoring); an empty selection shows nothing at all, since placing a mark
// opens its own wording box immediately (`markAnchor`) and leaves no in-between state to cover.
//
// Anchors are exclusive (PRODUCT.md §4.4): either button opens that anchor's wording box instead of
// marking a new one whenever the selection touches an anchor already there, this session's own or an
// earlier related entry's sealed one — `markAnchor` (`editor/anchorCommands.ts`) decides which, so
// this menu stays two plain buttons with no state of its own to track.
import { Highlighter, type LucideIcon, Strikethrough } from '@lucide/vue'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { ref } from 'vue'

import { useRovingTabindex } from '@/composables/useRovingTabindex'
import { markAnchor } from '@/editor/anchorCommands'
import type { AnchorKind } from '@/types/entry'

defineProps<{
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
  { label: 'Highlight', icon: Highlighter, shortcut: 'Ctrl+Alt+H', kind: 'comment' },
  { label: 'Strike', icon: Strikethrough, shortcut: 'Ctrl+Alt+S', kind: 'strike' },
]

/** True while a control inside the menu holds focus, so tabbing into it doesn't hide the menu. */
const menuFocused = ref(false)

const toolbar = ref<HTMLElement | null>(null)
const { handleFocusin, handleKeydown } = useRovingTabindex(toolbar)

function shouldShow({ state }: { state: { selection: Editor['state']['selection'] } }): boolean {
  if (menuFocused.value) return true
  return !state.selection.empty && state.selection instanceof TextSelection
}

function handleMenuFocusin(event: FocusEvent): void {
  menuFocused.value = true
  handleFocusin(event)
}
</script>

<template>
  <BubbleMenu :editor="editor" :should-show="shouldShow" :options="{ placement: 'top' }">
    <div
      ref="toolbar"
      class="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-md"
      role="toolbar"
      aria-label="Anchor actions"
      @focusin="handleMenuFocusin"
      @focusout="menuFocused = false"
      @keydown="handleKeydown"
    >
      <button
        v-for="action in actions"
        :key="action.label"
        type="button"
        class="rounded p-1.5 hover:bg-[var(--color-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
        data-toolbar-control
        :aria-label="action.label"
        :aria-keyshortcuts="action.shortcut"
        :title="`${action.label} (${action.shortcut})`"
        @mousedown.prevent
        @click="markAnchor(editor, action.kind)"
      >
        <component :is="action.icon" class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </BubbleMenu>
</template>
