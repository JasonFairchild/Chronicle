<script setup lang="ts">
import { computed, useId } from 'vue'
import type { EntryDates, EntryDetails } from '@/types/entry'

defineProps<{
  disabled?: boolean
}>()

const details = defineModel<EntryDetails>({ required: true })

const id = useId()

/** An emptied field becomes null, not '': "not answered" is a real state, and the column says so. */
function answer(value: string): string | null {
  return value.trim() ? value : null
}

/**
 * One date field, as a writable computed.
 *
 * Every write replaces the whole object rather than assigning into it, so a parent watching the
 * model sees a change without watching deeply — which is what gets these into the draft buffer.
 */
function dateField(name: keyof EntryDates) {
  return computed<string>({
    get: () => details.value.dates[name] ?? '',
    set: (value) => {
      details.value = { ...details.value, dates: { ...details.value.dates, [name]: answer(value) } }
    },
  })
}

/** One of the plain text fields, written whole the same way. */
function textField(name: Exclude<keyof EntryDetails, 'dates'>) {
  return computed<string>({
    get: () => details.value[name] ?? '',
    set: (value) => {
      details.value = { ...details.value, [name]: answer(value) }
    },
  })
}

const occurredAt = dateField('occurred_at')
const occurredTimeNote = dateField('occurred_time_note')
const location = textField('location')
const recordedAt = dateField('recorded_at')
const recordedTimeNote = dateField('recorded_time_note')
const originalMedium = textField('original_medium')
const originalMediumNote = textField('original_medium_note')

const legendClass =
  'mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]'
// One label column width for both groups, so their fields line up across the divider.
const gridClass =
  'grid gap-x-3 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,11rem)_minmax(0,1fr)] sm:items-center'
const inputClass =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <!--
    Location and medium are free text for now; ENTRY_MODEL.md has them becoming pick lists of the
    values already in use, a new one kept to choose again. The labels and hints are provisional too,
    until it's clearer what makes each field's intent obvious.

    The notes carry an `aria-label` rather than a visible one. Two visible "Time" labels in one group
    would give two controls the same accessible name, and spelling each out in full only repeats the
    row it already sits in.
  -->
  <div class="space-y-3">
    <fieldset>
      <legend :class="legendClass">When and where — optional</legend>

      <div :class="gridClass">
        <label :for="`${id}-occurred`" class="text-sm">Happened</label>
        <input
          :id="`${id}-occurred`"
          v-model="occurredAt"
          type="date"
          :disabled="disabled"
          :class="inputClass"
        />
        <input
          v-model="occurredTimeNote"
          type="text"
          aria-label="Time it happened"
          placeholder="morning, 3:30 pm"
          :disabled="disabled"
          :class="inputClass"
        />

        <label :for="`${id}-location`" class="text-sm">Where</label>
        <input
          :id="`${id}-location`"
          v-model="location"
          type="text"
          placeholder="home, grandma’s"
          :disabled="disabled"
          :class="[inputClass, 'sm:col-span-2']"
        />
      </div>
    </fieldset>

    <!-- The divider is on a wrapper: on the fieldset itself, the border would run through its legend. -->
    <div class="border-t border-[var(--color-border)] pt-3">
      <fieldset>
        <legend :class="legendClass">Written before, somewhere else — optional</legend>

        <div :class="gridClass">
          <label :for="`${id}-recorded`" class="text-sm">Originally written</label>
          <input
            :id="`${id}-recorded`"
            v-model="recordedAt"
            type="date"
            :disabled="disabled"
            :class="inputClass"
          />
          <input
            v-model="recordedTimeNote"
            type="text"
            aria-label="Time it was originally written"
            placeholder="evening, after dinner"
            :disabled="disabled"
            :class="inputClass"
          />

          <label :for="`${id}-medium`" class="text-sm">Written in</label>
          <input
            :id="`${id}-medium`"
            v-model="originalMedium"
            type="text"
            placeholder="paper journal"
            :disabled="disabled"
            :class="inputClass"
          />
          <input
            v-model="originalMediumNote"
            type="text"
            aria-label="More about what it was written in"
            placeholder="blue Moleskine, 2014–2016"
            :disabled="disabled"
            :class="inputClass"
          />
        </div>
      </fieldset>
    </div>
  </div>
</template>
