import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { renderComponent } from '@/testing/renderComponent'

/** A new entry's session, begun the way a view begins one before mounting the composer. */
function beginSession() {
  setActivePinia(createPinia())
  const session = useDraftSession()
  session.begin({ kind: 'new_root' })
  return session
}

describe('EntryComposer (browser)', () => {
  it('says why an entry with nothing written can’t be saved, even with a title', async () => {
    const onSave = vi.fn()
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave, onDiscard: vi.fn() },
    })

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
    expect(onSave).not.toHaveBeenCalled()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('says why a save or a discard failed, until the next change', async () => {
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: {
        onSave: vi.fn().mockRejectedValue(new Error('seal rejected')),
        onDiscard: vi.fn().mockRejectedValue(new Error('discard rejected')),
      },
    })

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()
    await expect
      .element(screen.getByRole('alert').and(screen.getByText('seal rejected', { exact: true })))
      .toBeVisible()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Saturday.')
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Discard' }).click()
    await expect
      .element(screen.getByRole('alert').and(screen.getByText('discard rejected', { exact: true })))
      .toBeVisible()
  })
})
