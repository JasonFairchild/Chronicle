import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import type { Router } from 'vue-router'
import NewEntryView from '@/views/NewEntryView.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { emptyEntryDates } from '@/types/entry'

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
  it('lands on the entry it saves', async () => {
    const router = createTestRouter()
    const screen = await mountNewEntry({ router })
    const sealDraft = vi.spyOn(useDraftsStore(), 'sealDraft')

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await vi.waitFor(() => expect(sealDraft).toHaveBeenCalledOnce())
    const saved = await sealDraft.mock.results[0]!.value
    await vi.waitFor(() => {
      expect(router.currentRoute.value).toMatchObject({
        name: 'entry-detail',
        params: { id: saved.id },
      })
    })
  })

  it('keeps what was written, and says why, when the save fails', async () => {
    vi.spyOn(draftRepository, 'seal').mockRejectedValue(new Error('seal rejected'))
    const router = createTestRouter()
    const screen = await mountNewEntry({ router })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await expect
      .element(screen.getByRole('alert').and(screen.getByText('seal rejected', { exact: true })))
      .toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('We drove up on Friday.')
    expect(router.currentRoute.value.name).toBe('new-entry')
    await expect.element(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled()
  })

  it('empties the page on Discard, ready for the next entry', async () => {
    const screen = await mountNewEntry()

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
    expect(screen.getByText('We drove up on Friday.').query()).toBeNull()
  })

  it('reopens the draft it was linked to, with its words, title and dates', async () => {
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

  it('keeps the version another tab saved first, and shows what this one had to copy', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountNewEntry({ draft: 'session-1' })
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('Half a thought')

    // Another tab, with its own stores over the same database, writes the draft first.
    setActivePinia(createPinia())
    const otherTab = useDraftsStore()
    await otherTab.resumeDraft('session-1')
    otherTab.recordChange('session-1', {
      content: textContent('Half a thought, finished elsewhere'),
      steps: [{ stepType: 'replace' }],
    })
    await otherTab.flush('session-1')

    // This tab hasn't caught up, so its next write lands on a draft that has moved on.
    await screen.getByRole('textbox', { name: 'New entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control} here')

    await expect
      .element(
        screen.getByText(
          'This draft was changed elsewhere at the same time, and now shows what was saved ' +
            'there. What you had here is below.',
        ),
      )
      .toBeVisible()
    await expect.element(screen.getByText('Half a thought here')).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('Half a thought, finished elsewhere')
  })
})
