<script setup lang="ts">
import {
  Bold,
  Eraser,
  Image,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  MoreHorizontal,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from '@lucide/vue'
import type { Editor } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'

import { useMedia } from '@/composables/useMedia'
import { useRovingTabindex } from '@/composables/useRovingTabindex'
import { MEDIA_NODE } from '@/domain/entryDocument'
import { toErrorMessage } from '@/utils/format'

const props = defineProps<{
  /** `@tiptap/vue-3`'s, whose state is reactive, so the controls follow the selection. */
  editor: Editor
  /** The editor's accessible name, which the toolbar's own is built from. */
  label: string
  /** Every control disabled, as while a save is in flight. */
  disabled: boolean
  /** Undo and Redo alone, for anchor mode, where formatting the parent's text is refused. */
  historyOnly?: boolean
}>()

const id = useId()
const media = useMedia()
const toolbar = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const attachError = ref<string | null>(null)

const { handleFocusin, handleKeydown } = useRovingTabindex(toolbar)

const linkOpen = ref(false)
const linkUrl = ref('')

const moreOpen = ref(false)
const moreToggle = ref<HTMLButtonElement | null>(null)
const morePanel = ref<HTMLElement | null>(null)

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!moreOpen.value) return
  const target = event.target as Node
  if (moreToggle.value?.contains(target) || morePanel.value?.contains(target)) return
  moreOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown))

/** Seeded from the link under the cursor, so clicking Link on an existing one edits it. */
function openLink(): void {
  if (linkOpen.value) {
    linkOpen.value = false
    return
  }

  linkUrl.value = (props.editor.getAttributes('link').href as string | undefined) ?? ''
  linkOpen.value = true
  moreOpen.value = false
}

/** One icon button in the toolbar. `active` is omitted for commands that are not a state to be in. */
interface ToolbarAction {
  label: string
  icon: LucideIcon
  active?: boolean
  enabled?: boolean
  run: () => void
}

/**
 * The toolbar, as data, grouped the way the buttons are laid out. Every action here is a StarterKit
 * command that already works from the keyboard, so this exposes what the editor can do rather than
 * adding to it — and heading levels belong to the text-style select, not this row.
 *
 * Strikethrough is included: it is ordinary formatting here, distinct from an anchor-op strike (a
 * related entry retracting part of its parent) by its own presentation, not by being withheld from
 * the toolbar. See PRODUCT.md, "Making anchor ops unmistakable".
 */
interface ToolbarGroups {
  history: ToolbarAction[]
  marks: ToolbarAction[]
  lists: ToolbarAction[]
  link: ToolbarAction[]
}

const toolbarGroups = computed<ToolbarGroups>(() => {
  const instance = props.editor
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
  if (props.editor.isActive('heading', { level: 2 })) return 'heading'
  if (props.editor.isActive('heading', { level: 3 })) return 'subheading'
  return 'paragraph'
})

function setTextStyle(event: Event): void {
  const chain = props.editor.chain().focus()
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

function toggleMore(): void {
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) linkOpen.value = false
}

function closeMore(returnFocus: boolean): void {
  moreOpen.value = false
  if (returnFocus) moreToggle.value?.focus()
}

function clearFormatting(): void {
  props.editor.chain().focus().unsetAllMarks().clearNodes().run()
  closeMore(false)
}

function triggerAddImage(): void {
  fileInput.value?.click()
  closeMore(false)
}

async function handleFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  attachError.value = null

  try {
    const mediaRef = await media.store(file)
    // The node carries the id; the editor fills in the src afterwards from an object URL, which
    // never becomes part of the document.
    props.editor
      .chain()
      .focus()
      .insertContent({ type: MEDIA_NODE, attrs: { mediaRef, alt: file.name } })
      .run()
  } catch (error) {
    attachError.value = toErrorMessage(error, 'Could not attach that image')
  }
}

/**
 * Applies to the whole link when the caret merely sits inside one, which is what a reader means by
 * "change this link". An empty address removes it instead, so the field doubles as the way out.
 * The href itself is left to the Link extension, which rejects protocols it does not allow.
 */
function applyLink(): void {
  const href = linkUrl.value.trim()
  const chain = props.editor.chain().focus().extendMarkRange('link')

  if (href) {
    chain.setLink({ href }).run()
  } else {
    chain.unsetLink().run()
  }

  linkOpen.value = false
}
</script>

<template>
  <div>
    <div
      ref="toolbar"
      class="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-2 py-1"
      role="toolbar"
      :aria-label="historyOnly ? `${label} toolbar` : `${label} formatting`"
      @focusin="handleFocusin"
      @keydown="handleKeydown"
    >
      <!--
        `mousedown.prevent` keeps the caret in the document. Without it the button takes focus on
        mousedown, and in a real browser the keystrokes after a click land on the button rather than
        in the text: Enter re-presses it and the words go nowhere. Restoring focus inside the click
        handler is too late to prevent that. Neither test runner reproduces it — both synthesize the
        click in a way that leaves focus where the handler puts it — so it is only ever caught by
        using the editor in a real browser.

        Every button here is icon-only, so `aria-label` carries the accessible name on its own.
        `title` is the mouse tooltip and never wins over `aria-label` when a name is computed.
      -->
      <button
        v-for="action in toolbarGroups.history"
        :key="action.label"
        type="button"
        class="rounded p-1.5 hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
        data-toolbar-control
        :aria-label="action.label"
        :title="action.label"
        :disabled="disabled || action.enabled === false"
        @mousedown.prevent
        @click="action.run"
      >
        <component :is="action.icon" class="h-4 w-4" aria-hidden="true" />
      </button>

      <template v-if="!historyOnly">
        <span aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--color-border)]" />

        <!-- A select, not two more toggle buttons: only one block type applies at a time, and a
             future one (a code block, say) is added here rather than growing the button row. -->
        <label :for="`${id}-text-style`" class="sr-only">Text style</label>
        <select
          :id="`${id}-text-style`"
          class="rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          data-toolbar-control
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
          <span
            v-if="index > 0"
            aria-hidden="true"
            class="mx-1 h-4 w-px bg-[var(--color-border)]"
          />
          <button
            v-for="action in group"
            :key="action.label"
            type="button"
            class="rounded p-1.5 hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
            :class="{ 'bg-[var(--color-surface)] text-[var(--color-accent)]': action.active }"
            data-toolbar-control
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
          The overflow menu: rarely-reached actions, and where a future addition to this toolbar
          belongs instead of another button crowding the row above. A disclosure, not a
          `menu`/`menuitem` widget — those roles promise arrow-key navigation this doesn't
          implement, so plain, independently-tabbable buttons in a revealed panel are the honest
          a11y choice.
        -->
        <div class="relative">
          <button
            ref="moreToggle"
            type="button"
            class="rounded p-1.5 hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
            :class="{ 'bg-[var(--color-surface)] text-[var(--color-accent)]': moreOpen }"
            data-toolbar-control
            :aria-expanded="moreOpen"
            :aria-controls="`${id}-more-menu`"
            aria-label="More formatting actions"
            title="More formatting actions"
            :disabled="disabled"
            @mousedown.prevent
            @click="toggleMore"
            @keydown.escape="closeMore(true)"
          >
            <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
          </button>
          <div
            v-if="moreOpen"
            :id="`${id}-more-menu`"
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

        <!-- Opens the file picker for Add image, its only way in, so it's hidden from everyone. -->
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          hidden
          data-testid="image-file-input"
          @change="handleFiles"
        />
      </template>
    </div>

    <!--
      A field rather than a browser prompt: it can be labelled, reached by keyboard, and tested
      like the rest of the toolbar.
    -->
    <div
      v-if="linkOpen"
      class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-2 py-2"
    >
      <label :for="`${id}-link-url`" class="text-sm">Link address</label>
      <input
        :id="`${id}-link-url`"
        v-model="linkUrl"
        type="url"
        placeholder="https://"
        class="min-w-48 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
        :disabled="disabled"
        @keyup.enter="applyLink"
      />
      <button type="button" class="btn-secondary px-2 py-1" :disabled="disabled" @click="applyLink">
        Apply link
      </button>
    </div>

    <p v-if="attachError" class="px-3 pt-2 text-sm text-[var(--color-error)]" role="alert">
      {{ attachError }}
    </p>
  </div>
</template>
