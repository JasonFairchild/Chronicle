<script setup lang="ts">
import DocumentEditor from '@/components/DocumentEditor.vue'
import EntryDatesFields from '@/components/EntryDatesFields.vue'
import type { DraftSession } from '@/composables/useDraftSession'

/**
 * The anchor-mode composer: the parent gaining provisional anchors on the left, the related
 * entry's own prose on the right, sealing atomically together (AUTHORING.md, "Drafts").
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
    <section>
      <h2 class="mb-2 text-sm font-medium">This entry</h2>
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

    <section>
      <h2 class="mb-2 text-sm font-medium">The related entry</h2>
      <p class="mb-2 text-sm text-[var(--color-text-muted)]">
        Marking a passage is optional — with nothing marked this becomes a note about the entry as a
        whole.
      </p>

      <EntryDatesFields
        :model-value="session.dates"
        :disabled="session.saving"
        @update:model-value="session.handleDatesChange"
      />

      <DocumentEditor
        :key="session.editorKey"
        label="Related entry"
        with-title
        :title="session.title"
        :content="session.content"
        :disabled="session.saving"
        @change="session.handleChange"
      />

      <p v-if="session.staleNotice" class="mt-2 text-sm text-[var(--color-error)]" role="status">
        {{ session.staleNotice }}
      </p>

      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-accent)]"
          :disabled="session.saving"
          @click="$emit('discard')"
        >
          Discard
        </button>
        <!--
          `canSave` rather than a check of its own: an entry that says nothing is not one, and
          asking the same question the seal will ask is what keeps the button from offering a save
          the store is bound to refuse.
        -->
        <button
          type="button"
          class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="session.saving || !session.canSave"
          @click="$emit('save')"
        >
          Add entry
        </button>
      </div>
    </section>
  </div>
</template>
