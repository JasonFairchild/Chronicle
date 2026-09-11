/**
 * Turning values into text for a person to read: a stored timestamp, and whatever a `catch` caught.
 *
 * Both were hand-rolled once per view and had already drifted — three `formatDate`s disagreeing on
 * their style, a dozen copies of the same `err instanceof Error` ternary. Neither belongs in the
 * domain layer: nothing here is about what an entry *is*, only about how one is shown.
 */

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
 * The message to show for a caught value.
 *
 * `catch` binds `unknown`, and a repository or validation rejection carries a sentence worth
 * showing, so a real `Error` speaks for itself. An empty message falls back too: a blank alert says
 * less than the caller's own wording for what failed.
 */
export function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
