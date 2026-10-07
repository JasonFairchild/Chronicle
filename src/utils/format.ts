/**
 * Turning values into text for a person to read: a stored timestamp, an entry's name, and whatever
 * a `catch` caught. Held in one place so views can't drift on how a date or an error reads.
 *
 * Deliberately not the domain layer: nothing here is about what an entry *is*, only how one shows.
 */

import { previewText } from '@/domain/entryDocument'
import type { EntryDates, EntryDetails } from '@/types/entry'

/**
 * How to name an entry where only one line fits — a picker option, a connection's arrow, the note a
 * revision warning is about. Its title if it has one, otherwise the opening of what it says; an
 * entry with neither still needs naming rather than appearing as a blank row.
 *
 * Structurally typed on the two fields it reads, because it names both stored entries and the
 * aggregated form the timeline hands back, and neither is a subtype of the other.
 */
export function entryLabel(entry: { title: string | null; content: string }): string {
  return entry.title || previewText(entry.content, 60) || 'Untitled entry'
}

/**
 * A stored ISO timestamp as local text.
 *
 * `dateStyle` is the one thing call sites genuinely differ on — a timeline card wants a compact
 * date, an entry's own header wants the full one — so it is a parameter rather than two functions.
 * The locale is deliberately the browser's, since this is a local-first app with one reader.
 */
export function formatDate(iso: string, dateStyle: 'full' | 'medium' = 'medium'): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle, timeStyle: 'short' }).format(new Date(iso))
}

/**
 * An entry's user-supplied dates as labelled lines — "Happened Jun 11, 1994 · late morning". One
 * line per date given, so a caller renders what it gets and nothing when nothing was said, and the
 * two never have to be joined into one sentence where the separator would mean two different things.
 */
export function entryWhenLines(dates: EntryDates): string[] {
  const happened = formatWhen(dates.occurred_at, dates.occurred_time_note)
  const written = formatWhen(dates.recorded_at, dates.recorded_time_note)

  return [
    ...(happened ? [`Happened ${happened}`] : []),
    ...(written ? [`Originally written ${written}`] : []),
  ]
}

/**
 * Every detail the writer gave, as labelled lines in the form's order: when it happened and where,
 * then when and in what it was first written. For an entry's own page; a card, with less room,
 * shows `entryWhenLines`. "Where" takes a colon because it asks rather than describes.
 */
export function entryDetailLines(details: EntryDetails): string[] {
  const { dates } = details
  const happened = formatWhen(dates.occurred_at, dates.occurred_time_note)
  const where = details.location?.trim()
  const written = formatWhen(dates.recorded_at, dates.recorded_time_note)
  const medium = phrase(details.original_medium, details.original_medium_note)

  return [
    ...(happened ? [`Happened ${happened}`] : []),
    ...(where ? [`Where: ${where}`] : []),
    ...(written ? [`Originally written ${written}`] : []),
    ...(medium ? [`Written in ${medium}`] : []),
  ]
}

/**
 * A user-supplied day and its freeform time as one phrase — "Jun 12, 1994 · morning". Either half
 * alone is a legitimate answer, since a remembered "one winter evening" with no date is still worth
 * keeping.
 */
function formatWhen(
  day: string | null | undefined,
  timeNote: string | null | undefined,
): string | null {
  return phrase(day ? formatDay(day) : null, timeNote)
}

/** A value and its note as "value · note", either alone, or null when neither says anything. */
function phrase(value: string | null | undefined, note: string | null | undefined): string | null {
  const main = value?.trim() ?? ''
  const extra = note?.trim() ?? ''

  if (main && extra) return `${main} · ${extra}`
  return main || extra || null
}

/**
 * A date-only `YYYY-MM-DD` as local text.
 *
 * Split into parts rather than handed to `new Date(string)`, which reads a date-only string as UTC
 * midnight and so renders the day *before* in every negative-offset timezone — the entered date
 * changing on its way to the screen. Anything not shaped like a day is shown as stored rather than
 * as "Invalid Date".
 */
function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(year, month - 1, date),
  )
}

/**
 * The message to show for a caught value.
 *
 * `catch` binds `unknown`, and a repository or validation rejection carries a sentence worth
 * showing, so a real `Error` speaks for itself. An empty message falls back too: a blank alert says
 * less than the caller's own wording for what failed.
 */
export function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
