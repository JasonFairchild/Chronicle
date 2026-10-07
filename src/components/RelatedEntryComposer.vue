<script setup lang="ts">
import DocumentEditor from '@/components/DocumentEditor.vue'
import EntryComposer from '@/components/EntryComposer.vue'
import type { DraftSession } from '@/composables/useDraftSession'

/**
 * The anchor-mode composer: the parent gaining provisional anchors on the left, the related
 * entry written in `EntryComposer` on the right, sealing atomically together (AUTHORING.md,
 * "Drafts"). The parent gets no fields: an anchor revision gains the anchors and nothing else
 * (PRODUCT.md §4.4).
 *
 * Shared rather than owned by `EntryDetailView`, because a session left as a draft has to come back
 * exactly as it was — and the only place to resume one from is `DraftsView`. Two copies of this
 * layout would be two chances for the halves to drift apart.
 *
 * Deliberately holds no session of its own: whoever opens one decides whether it is beginning
 * (`session.begin`) or resuming (`session.resume`), and owns what happens after it is sealed.
 */
defineProps<{
  session: DraftSession
}>()

defineEmits<{
  save: []
  discard: []
}>()
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-2">
    <section aria-labelledby="anchor-mode-parent-heading">
      <h2 id="anchor-mode-parent-heading" class="mb-2 text-sm font-medium">This entry</h2>
      <p id="anchor-mode-instructions" class="mb-2 text-sm text-[var(--color-text-muted)]">
        Select a passage, then Highlight or Strike it (Ctrl+Alt+H / Ctrl+Alt+S) — or place the
        cursor and type to propose wording. Click an anchor you've placed to change its wording,
        switch it between highlight and strike, or remove it. Surrounding text cannot otherwise be
        changed from here.
      </p>

      <DocumentEditor
        :key="session.editorKey"
        label="Entry being annotated"
        anchor-mode
        with-title
        :title="session.parentTitle"
        :content="session.parentContent"
        :anchor-base-content="session.parentBaseContent"
        :disabled="session.saving"
        described-by="anchor-mode-instructions"
        @change="session.handleParentChange"
      />
    </section>

    <section aria-labelledby="anchor-mode-related-heading">
      <h2 id="anchor-mode-related-heading" class="mb-2 text-sm font-medium">The related entry</h2>
      <p class="mb-2 text-sm text-[var(--color-text-muted)]">
        Marking a passage is optional — with nothing marked this becomes a note about the entry as a
        whole.
      </p>

      <EntryComposer
        :session="session"
        label="Related entry"
        save-label="Add entry"
        @save="$emit('save')"
        @discard="$emit('discard')"
      />
    </section>
  </div>
</template>
