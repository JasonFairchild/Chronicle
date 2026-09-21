<script setup lang="ts">
/**
 * Anchor mode's whole action set, as a floating menu over the current selection. Built on TipTap's
 * `BubbleMenu` so positioning and show/hide timing come from the library rather than being
 * reinvented here.
 *
 * Actions are derived from the **selection** on every render, never remembered between clicks: a
 * range of ordinary text offers the two mark actions; a selected media node offers none yet
 * (PRODUCT.md §6, image anchoring); an empty selection shows nothing at all, since placing a mark
 * opens its own wording box immediately (`markAnchor`) and leaves no in-between state to cover.
 *
 * Anchors are exclusive (PRODUCT.md §4.4): either button opens that anchor's wording box instead of
 * marking a new one whenever the selection touches an anchor already there, this session's own or an
 * earlier child's sealed one — `markAnchor` (`editor/anchorCommands.ts`) decides which, so this menu
 * stays two plain buttons with no state of its own to track.
 */
import { ref } from 'vue'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Highlighter, Strikethrough, type LucideIcon } from '@lucide/vue'
import type { AnchorKind } from '@/types/entry'

defineProps<{
  editor: Editor
}>()

const emit = defineEmits<{
  mark: [kind: AnchorKind]
}>()

/** Mirrors `DocumentEditor`'s `ToolbarAction` shape, so this reads like the rest of the file. */
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

function shouldShow({ state }: { state: { selection: Editor['state']['selection'] } }): boolean {
  if (menuFocused.value) return true
  return !state.selection.empty && state.selection instanceof TextSelection
}

/**
 * Roving tabindex: one Tab stop for the whole toolbar, arrow keys move within it. Worth doing
 * properly rather than leaving each button independently tabbable, even with only two controls here.
 */
const buttons = ref<(HTMLButtonElement | null)[]>([])
const activeIndex = ref(0)

function setButtonRef(el: unknown, index: number): void {
  buttons.value[index] = el instanceof HTMLButtonElement ? el : null
}

function focusIndex(index: number): void {
  const count = actions.length
  activeIndex.value = (index + count) % count
  buttons.value[activeIndex.value]?.focus()
}

function handleToolbarKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusIndex(activeIndex.value + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusIndex(activeIndex.value - 1)
  }
}
</script>

<template>
  <BubbleMenu :editor="editor" :should-show="shouldShow" :options="{ placement: 'top' }">
    <div
      class="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-md"
      role="toolbar"
      aria-label="Anchor actions"
      @focusin="menuFocused = true"
      @focusout="menuFocused = false"
      @keydown="handleToolbarKeydown"
    >
      <button
        v-for="(action, index) in actions"
        :key="action.label"
        :ref="(el) => setButtonRef(el, index)"
        type="button"
        class="rounded p-1.5 hover:bg-[var(--color-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
        :tabindex="index === activeIndex ? 0 : -1"
        :aria-label="action.label"
        :aria-keyshortcuts="action.shortcut"
        :title="`${action.label} (${action.shortcut})`"
        @mousedown.prevent
        @focus="activeIndex = index"
        @click="emit('mark', action.kind)"
      >
        <component :is="action.icon" class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </BubbleMenu>
</template>
