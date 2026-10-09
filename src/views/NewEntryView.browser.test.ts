import { describe, expect, it, vi } from 'vitest'
import NewEntryView from '@/views/NewEntryView.vue'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'

/** Mounts the view behind a real router already at the new-entry page. */
async function mountNewEntry() {
  const router = createTestRouter()
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
})
