<script setup lang="ts">
import { computed, useId } from 'vue'
import type { EntryDates } from '@/types/entry'

defineProps<{
  disabled?: boolean
}>()

const dates = defineModel<EntryDates>({ required: true })

const id = useId()

/**
 * One field of the set, as a writable computed.
 *
 * Every write replaces the whole object rather than assigning into it, so a parent watching the
 * model sees a change without watching deeply — which is what gets these into the draft buffer.
 * An emptied field becomes null rather than an empty string: "not answered" is a real state here and
 * the stored column says so.
 */
function field(name: keyof EntryDates) {
  return computed<string>({
    get: () => dates.value[name] ?? '',
    set: (value) => {
      dates.value = { ...dates.value, [name]: value.trim() ? value : null }
    },
  })
}

const occurredAt = field('occurred_at')
const occurredTimeNote = field('occurred_time_note')
const recordedAt = field('recorded_at')
const recordedTimeNote = field('recorded_time_note')
</script>

<template>
  <fieldset class="mb-3">
    <legend
      class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
    >
      When — optional
    </legend>

    <!--
      The time fields carry an `aria-label` rather than a visible one. Two visible "Time" labels in
      one group would give two controls the same accessible name, and spelling each out in full
      ("Time it happened") only repeats the row it already sits in.
    -->
    <div
      class="grid gap-x-3 gap-y-1.5 sm:grid-cols-[auto_minmax(0,11rem)_minmax(0,1fr)] sm:items-center"
    >
      <label :for="`${id}-occurred`" class="text-sm">Happened</label>
      <input
        :id="`${id}-occurred`"
        v-model="occurredAt"
        type="date"
        :disabled="disabled"
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        v-model="occurredTimeNote"
        type="text"
        aria-label="Time it happened"
        placeholder="morning, 3:30 pm"
        :disabled="disabled"
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />

      <label :for="`${id}-recorded`" class="text-sm">Originally written</label>
      <input
        :id="`${id}-recorded`"
        v-model="recordedAt"
        type="date"
        :disabled="disabled"
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        v-model="recordedTimeNote"
        type="text"
        aria-label="Time it was originally written"
        placeholder="evening, after dinner"
        :disabled="disabled"
        class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  </fieldset>
</template>
