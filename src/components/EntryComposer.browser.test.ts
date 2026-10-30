import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { draftRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { emptyEntryDates } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** A new entry's session, begun the way a view begins one before mounting the composer. */
function beginSession() {
  setActivePinia(createPinia())
  const session = useDraftSession()
  session.begin({ kind: 'new_root' })
  return session
}

describe('EntryComposer (browser)', () => {
  it('shows all of a draft that will not reopen to copy from, with nothing to change and only Discard', async () => {
    const text =
      'Everything I meant to say about the lake that summer: the cabin, the dock, the long drive ' +
      'home, and why none of it went the way we planned.'
    await draftRepository.save({
      ...makeDraft('session-1', {
        entry: {
          content: textContent(text),
          title: 'Lake Tahoe',
          dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
          events: TYPED,
        },
      }),
      started_at: 'not a timestamp',
    })
    setActivePinia(createPinia())
    const session = useDraftSession()
    await session.resume('session-1')
    const onDiscard = vi.fn()

    const screen = renderComponent(EntryComposer, {
      props: { session, label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard },
    })

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
    await expect.element(screen.getByText('Lake Tahoe')).toBeVisible()
    await expect.element(screen.getByText(text)).toBeVisible()
    // Exact, or "Happened" would also match the "Time it happened" beside it.
    const happened = screen.getByLabelText('Happened', { exact: true })
    await expect.element(happened).toHaveValue('1994-06-11')
    await expect.element(happened).toHaveAttribute('readonly')
    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Save entry' })).not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

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

  it('says the draft isn’t being saved, until trying again saves it', async () => {
    const save = vi.spyOn(draftRepository, 'save').mockRejectedValue(new Error('Quota'))
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn() },
    })

    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await expect
      .element(
        screen
          .getByRole('alert')
          .and(screen.getByText('This draft isn’t being saved right now.', { exact: true })),
      )
      .toBeVisible()

    save.mockRestore()
    await screen.getByRole('button', { name: 'Try again' }).click()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  })
})
