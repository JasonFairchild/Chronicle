<script setup lang="ts">
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
  /** Awaited by `EntryComposer`, which says why one fails. */
  onSave: () => Promise<void> | void
  onDiscard: () => Promise<unknown> | void
}>()
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-2">
    <section aria-labelledby="anchor-mode-parent-heading">
      <h2 id="anchor-mode-parent-heading" class="mb-2 text-sm font-medium">This entry</h2>
      <p
        v-if="!session.readOnly"
        id="anchor-mode-instructions"
        class="mb-2 text-sm text-[var(--color-text-muted)]"
      >
        Select a passage, then Highlight or Strike it (Ctrl+Alt+H / Ctrl+Alt+S) — or place the
        cursor and type to propose wording. Click an anchor you've placed to change its wording,
        switch it between highlight and strike, or remove it. Surrounding text cannot otherwise be
        changed from here.
      </p>

      <!-- A read-only draft shows the anchors it placed, for reading alongside its related entry. -->
      <DocumentEditor
        :key="session.editorKey"
        label="Entry being annotated"
        :anchor-mode="!session.readOnly"
        :display-only="session.readOnly"
        with-title
        :title="session.parentTitle"
        :content="session.parentContent"
        :anchor-base-content="session.parentBaseContent"
        :disabled="session.saving"
        :described-by="session.readOnly ? undefined : 'anchor-mode-instructions'"
        @change="session.handleParentChange"
      />
    </section>

    <section aria-labelledby="anchor-mode-related-heading">
      <h2 id="anchor-mode-related-heading" class="mb-2 text-sm font-medium">The related entry</h2>
      <p v-if="!session.readOnly" class="mb-2 text-sm text-[var(--color-text-muted)]">
        Marking a passage is optional — with nothing marked this becomes a note about the entry as a
        whole.
      </p>

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
