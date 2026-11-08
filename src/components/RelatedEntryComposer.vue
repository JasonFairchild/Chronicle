<script setup lang="ts">
import { useId } from 'vue'

import DocumentEditor from '@/components/DocumentEditor.vue'
import EntryComposer from '@/components/EntryComposer.vue'
import type { DraftSession } from '@/composables/useDraftSession'

// The anchor-mode composer: the parent gaining provisional anchors on the left, the related
// entry written in `EntryComposer` on the right, sealing atomically together (AUTHORING.md,
// "Drafts"). The parent gets no fields: an anchor revision gains the anchors and nothing else
// (PRODUCT.md §4.4).
//
// Its own component though `EntryDetailView` is its only host: the two halves, and how each reads
// when the draft is read-only, are one unit apart from that page's choice of what to show.
//
// Deliberately holds no session of its own: whoever opens one decides whether it is beginning
// (`session.begin`) or resuming (`session.resume`), and owns what happens after it is sealed.
defineProps<{
  session: DraftSession
  /** The parent's title, or its dateline when it has none. */
  parentHeading: string
  /** False for a dateline, which is muted so it never reads as a title. */
  parentTitled: boolean
  parentMetaLine: string
  /** Awaited by `EntryComposer`, which says why one fails. */
  onSave: () => Promise<void> | void
  onDiscard: () => Promise<unknown> | void
}>()

const parentLabelId = useId()
const relatedLabelId = useId()
const instructionsId = useId()
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-2">
    <section :aria-labelledby="parentLabelId">
      <h2 :id="parentLabelId" class="mb-2 text-sm font-medium">This entry</h2>
      <!-- Spaced as `EntryComposer` spaces its Title field and editor, so the columns line up. -->
      <div class="space-y-3">
        <div>
          <p class="text-xl" :class="parentTitled ? 'font-bold' : 'text-[var(--color-text-muted)]'">
            {{ parentHeading }}
          </p>
          <p v-if="parentMetaLine" class="mt-1 text-sm text-[var(--color-text-muted)]">
            {{ parentMetaLine }}
          </p>
        </div>

        <!-- A read-only draft shows the anchors it placed, for reading alongside its related entry. -->
        <DocumentEditor
          :key="session.editorKey"
          label="Entry being annotated"
          :anchor-mode="!session.readOnly"
          :display-only="session.readOnly"
          :content="session.parentContent"
          :anchor-base-content="session.parentBaseContent"
          :disabled="session.saving"
          :described-by="session.readOnly ? undefined : instructionsId"
          @change="session.handleParentChange"
        />
      </div>

      <p
        v-if="!session.readOnly"
        :id="instructionsId"
        class="mt-3 text-sm text-[var(--color-text-muted)]"
      >
        Select a passage, then Highlight or Strike it (Ctrl+Alt+H / Ctrl+Alt+S) — or place the
        cursor and type to propose wording. Click an anchor you've placed to change its wording,
        switch it between highlight and strike, or remove it. Surrounding text cannot otherwise be
        changed from here. Marking a passage is optional — with nothing marked the related entry is
        a note about this one as a whole.
      </p>
    </section>

    <section :aria-labelledby="relatedLabelId">
      <h2 :id="relatedLabelId" class="mb-2 text-sm font-medium">The related entry</h2>

      <EntryComposer
        :session="session"
        label="Related entry"
        save-label="Add entry"
        @save="onSave"
        @discard="onDiscard"
      />
    </section>
  </div>
</template>
