import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import NewEntryView from '@/views/NewEntryView.vue'
import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'

/** Mounts the view behind a real router already at the new-entry page. */
async function mountNewEntry(router = createTestRouter()) {
  await router.push('/entries/new')
  await router.isReady()

  return renderComponent(NewEntryView, { global: { plugins: [router] } })
}

describe('NewEntryView (browser)', () => {
  it('says why an entry with nothing written can’t be saved, even with a title', async () => {
    const screen = await mountNewEntry()
    const sealDraft = vi.spyOn(useDraftsStore(), 'sealDraft')

    await screen.getByRole('button', { name: 'Save entry' }).click()
    await expect
      .element(
        screen.getByRole('alert').and(
          screen.getByText('Write something in the entry first. A title alone can’t be saved.', {
            exact: true,
          }),
        ),
      )
      .toBeVisible()

    // Any change answers it, even one that still leaves nothing written: a title names an entry
    // without being one, and spaces say nothing.
    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('   ')
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Save entry' }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    expect(sealDraft).not.toHaveBeenCalled()
  })

  it('lands on the entry it saves', async () => {
    const router = createTestRouter()
    const screen = await mountNewEntry(router)
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
    vi.spyOn(draftRepository, 'seal').mockRejectedValue(new Error('Storage is unavailable'))
    const router = createTestRouter()
    const screen = await mountNewEntry(router)

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await expect
      .element(
        screen.getByRole('alert').and(screen.getByText('Storage is unavailable', { exact: true })),
      )
      .toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('We drove up on Friday.')
    expect(router.currentRoute.value.name).toBe('new-entry')
  })

  it('empties the page on Discard, ready for the next entry', async () => {
    const screen = await mountNewEntry()

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
    expect(screen.getByText('We drove up on Friday.').query()).toBeNull()
  })
})
