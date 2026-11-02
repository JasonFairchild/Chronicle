import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { emptyEntryDates } from '@/types/entry'
import { formatTime } from '@/utils/format'

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
    await expect.element(screen.getByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
    await expect.element(screen.getByText(text)).toBeVisible()
    // Exact, or "Happened" would also match the "Time it happened" beside it.
    const happened = screen.getByLabelText('Happened', { exact: true })
    await expect.element(happened).toHaveValue('1994-06-11')
    await expect.element(happened).toHaveAttribute('readonly')
    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Save entry' })).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Bookmark this moment' }))
      .not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('passes the title on as typed, spaces and all', async () => {
    const session = beginSession()
    const handleFieldsChange = vi.spyOn(session, 'handleFieldsChange')
    const screen = renderComponent(EntryComposer, {
      props: { session, label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn() },
    })

    const title = screen.getByRole('textbox', { name: 'Title' })
    await title.fill('Lake Tahoe ')

    expect(handleFieldsChange).toHaveBeenLastCalledWith({ title: 'Lake Tahoe ' })
    await expect.element(title).toHaveValue('Lake Tahoe ')
  })

  it('keeps the title in place, disabled, and Bookmark disabled, while a save is in flight', async () => {
    vi.spyOn(draftRepository, 'seal').mockReturnValue(new Promise<never>(() => {}))
    const session = beginSession()
    const screen = renderComponent(EntryComposer, {
      props: { session, label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: () => session.save(), onDiscard: vi.fn() },
    })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    const title = screen.getByRole('textbox', { name: 'Title' })
    await expect.element(title).toBeDisabled()
    await expect.element(title).toHaveValue('Lake Tahoe')
    await expect
      .element(screen.getByRole('button', { name: 'Bookmark this moment' }))
      .toBeDisabled()
  })

  it('bookmarks this moment of the draft, and says when', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const at = new Date(2026, 10, 2, 15, 41)
    vi.setSystemTime(at)
    const session = beginSession()
    const bookmark = vi.spyOn(session, 'bookmark')
    const screen = renderComponent(EntryComposer, {
      props: { session, label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn() },
    })

    await screen.getByRole('button', { name: 'Bookmark this moment' }).click()

    expect(bookmark).toHaveBeenCalledOnce()
    await expect
      .element(
        screen
          .getByRole('status')
          .and(screen.getByText(`Bookmarked at ${formatTime(at.toISOString())}`, { exact: true })),
      )
      .toBeVisible()
  })

  it('moves from the title into the body on Enter', async () => {
    const onChange = vi.fn()
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn(), onChange },
    })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')

    expect(docToPlainText(onChange.mock.lastCall![0].content)).toBe('We drove up on Friday.')
  })

  it('moves from the title onto the toolbar on Tab', async () => {
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn() },
    })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Tab}')

    await expect
      .poll(() => document.activeElement?.closest('[role="toolbar"]')?.getAttribute('aria-label'))
      .toBe('New entry formatting')
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

  it('clears why it couldn’t save once the title changes', async () => {
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn() },
    })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('button', { name: 'Save entry' }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe, 1994')
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  })

  it('clears why it couldn’t save once a detail changes', async () => {
    const screen = renderComponent(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: vi.fn(), onDiscard: vi.fn() },
    })

    await screen.getByRole('button', { name: 'Save entry' }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()

    await screen.getByLabelText('Where', { exact: true }).fill('Lake Tahoe')
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
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
