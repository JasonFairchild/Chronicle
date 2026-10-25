import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { textContent } from '@/testing/documents'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { emptyEntryDates } from '@/types/entry'
import NewEntryView from '@/views/NewEntryView.vue'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts the view behind a real router already at the new-entry page, linked to `draft` if given. */
async function mountNewEntry({
  router = createTestRouter(),
  draft,
}: { router?: Router; draft?: string } = {}) {
  await router.push({ name: 'new-entry', query: { draft } })
  await router.isReady()

  return renderComponent(NewEntryView, { global: { plugins: [router] } })
}

describe('NewEntryView (browser)', () => {
  it('leaves for the saved entry on Save', async () => {
    const router = createTestRouter()
    const screen = await mountNewEntry({ router })

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('entry-detail'))
  })

  it('names its draft in the URL, and a new one once Discard empties the page', async () => {
    const router = createTestRouter()
    const screen = await mountNewEntry({ router })
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query.draft).toEqual(expect.any(String)),
    )
    const first = router.currentRoute.value.query.draft

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
    expect(screen.getByText('We drove up on Friday.').query()).toBeNull()
    await vi.waitFor(() => expect(router.currentRoute.value.query.draft).not.toBe(first))
    expect(router.currentRoute.value.query.draft).toEqual(expect.any(String))
  })

  it('keeps what was written, and says why, when the discard fails', async () => {
    vi.spyOn(draftRepository, 'delete').mockRejectedValue(new Error('discard rejected'))
    const screen = await mountNewEntry()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect
      .element(screen.getByRole('alert').and(screen.getByText('discard rejected', { exact: true })))
      .toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('We drove up on Friday.')
  })

  it('starts afresh, under a new name, when the draft it links to is gone', async () => {
    const router = createTestRouter()
    const screen = await mountNewEntry({ router, draft: 'session-gone' })

    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).toBeVisible()
    await vi.waitFor(() => expect(router.currentRoute.value.query.draft).not.toBe('session-gone'))
    expect(router.currentRoute.value.query.draft).toEqual(expect.any(String))
  })

  it('says why the draft it links to could not be read, and starts afresh', async () => {
    vi.spyOn(draftRepository, 'getById').mockRejectedValue(new Error('read rejected'))
    const router = createTestRouter()
    const screen = await mountNewEntry({ router, draft: 'session-1' })

    await expect
      .element(screen.getByRole('alert').and(screen.getByText('read rejected', { exact: true })))
      .toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).toBeVisible()
    await vi.waitFor(() => expect(router.currentRoute.value.query.draft).not.toBe('session-1'))
    expect(router.currentRoute.value.query.draft).toEqual(expect.any(String))
  })

  it('reopens the draft it links to, with its words, title and dates', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', {
        entry: {
          content: textContent('Half a thought'),
          title: 'Lake Tahoe',
          dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
          events: TYPED,
        },
      }),
    )

    const screen = await mountNewEntry({ draft: 'session-1' })

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('Half a thought')
    // Exact, or "Happened" would also match the "Time it happened" beside it.
    await expect
      .element(screen.getByLabelText('Happened', { exact: true }))
      .toHaveValue('1994-06-11')
  })

  it('shows a linked draft that will not reopen, and starts afresh once it is discarded', async () => {
    await seedDraft(draftRepository, {
      ...makeDraft('session-1', {
        entry: { content: textContent('Half a thought'), events: TYPED },
      }),
      started_at: 'not a timestamp',
    })

    const screen = await mountNewEntry({ draft: 'session-1' })

    await expect
      .element(
        screen
          .getByRole('alert')
          .and(
            screen.getByText(
              'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
              { exact: true },
            ),
          ),
      )
      .toBeVisible()
    await expect.element(screen.getByText('Half a thought')).toBeVisible()

    await screen.getByRole('button', { name: 'Discard' }).click()

    // Shown read-only, it had no textbox; one appearing is the fresh draft.
    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).toBeVisible()
    expect(screen.getByText('Half a thought').query()).toBeNull()
  })

  it('offers a new entry once its draft is saved or discarded elsewhere', async () => {
    const stored = await draftRepository.save(
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountNewEntry({ draft: 'session-1' })
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('Half a thought')

    // Another tab's save or discard leaves no row; returning here catches up, as App does on focus.
    await draftRepository.delete('session-1', stored)
    await useDraftsStore().adoptChangesElsewhere()

    await expect
      .element(screen.getByText('This draft was saved or discarded elsewhere.'))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Start a new entry' }).click()

    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).toBeVisible()
    expect(screen.getByText('Half a thought').query()).toBeNull()
    expect(screen.getByText('This draft was saved or discarded elsewhere.').query()).toBeNull()
  })

  it('lets go of the draft it holds when it is left', async () => {
    const router = createTestRouter()
    const screen = await mountNewEntry({ router })
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query.draft).toEqual(expect.any(String)),
    )
    const id = router.currentRoute.value.query.draft
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')

    screen.unmount()

    expect(abandonDraft).toHaveBeenCalledExactlyOnceWith(id)
  })
})
