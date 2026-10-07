import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import App from '@/App.vue'
import NewEntryView from '@/views/NewEntryView.vue'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import type { EntryRepository } from '@/repositories/entryRepository'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'

/** Mounts `component` behind a real router already at the new-entry page. */
async function mountAt(component: typeof App | typeof NewEntryView) {
  const router = createTestRouter()
  await router.push('/entries/new')
  await router.isReady()

  return renderComponent(component, { global: { plugins: [router] } })
}

describe('NewEntryView (browser)', () => {
  let entries: EntryRepository

  beforeEach(() => {
    entries = freshEntryRepository()
    freshDraftRepository()
  })

  it('holds what is written as a draft until it is saved, then lands on the entry, details and all', async () => {
    const screen = await mountAt(App)

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    // Exact, or a label would also match the note beside it ("Time it happened").
    await screen.getByLabelText('Happened', { exact: true }).fill('1994-06-11')
    await screen.getByLabelText('Time it happened').fill('late morning')
    await screen.getByLabelText('Where', { exact: true }).fill('home')
    await screen.getByLabelText('Originally written', { exact: true }).fill('1994-06-12')
    await screen.getByLabelText('Written in', { exact: true }).fill('paper journal')
    await screen.getByLabelText('More about what it was written in').fill('blue Moleskine')

    // Still a draft: nothing a person has not finished belongs in the timeline.
    await vi.waitFor(async () => {
      expect(await draftRepository.list()).toHaveLength(1)
    })
    expect(await entries.listRootEntries()).toEqual([])

    await screen.getByRole('button', { name: 'Save entry' }).click()

    await expect.element(screen.getByRole('heading', { name: 'Lake Tahoe' })).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Entry content' }))
      .toHaveTextContent('We drove up on Friday.')
    await expect.element(screen.getByText(/Happened .*1994 · late morning/)).toBeVisible()
    await expect.element(screen.getByText('Where: home', { exact: true })).toBeVisible()
    // Not asked for, so not invented.
    await expect.element(screen.getByText(/^Originally written .*1994$/)).toBeVisible()
    await expect
      .element(screen.getByText('Written in paper journal · blue Moleskine', { exact: true }))
      .toBeVisible()

    const [saved] = await entries.listRootEntries()
    expect(saved?.authoring_trace?.events.length).toBeGreaterThan(0)
    // The buffer is working space, so sealing discards it rather than leaving a duplicate behind.
    expect(await draftRepository.list()).toEqual([])
  })

  it('saves an entry that was never given a title', async () => {
    const screen = await mountAt(App)

    // The title field is offered and skipped. A daily journal is mostly entries nobody would name,
    // and a required title there produces filler rather than better names.
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await expect
      .element(screen.getByRole('textbox', { name: 'Entry content' }))
      .toHaveTextContent('We drove up on Friday.')
    const [saved] = await entries.listRootEntries()
    expect(saved?.title).toBeNull()
  })

  it('throws a draft away on Discard and starts over empty', async () => {
    const screen = await mountAt(NewEntryView)

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    // On disk first, so there is a row for Discard to remove.
    await vi.waitFor(async () => {
      expect(await draftRepository.list()).toHaveLength(1)
    })
    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
    expect(screen.getByText('We drove up on Friday.').query()).toBeNull()
    // Resolves once the delete has landed.
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
  })

  it('leaves no draft behind for a page that was only opened', async () => {
    const screen = await mountAt(NewEntryView)
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    screen.unmount()

    // Resolves once the session's flush has landed, so an empty draft would be on disk by now.
    expect(abandonDraft).toHaveBeenCalledOnce()
    await abandonDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
  })

  it('keeps what was typed, details and all, when the page is left without saving', async () => {
    const screen = await mountAt(NewEntryView)
    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')
    await screen.getByLabelText('Happened', { exact: true }).fill('1994-06-11')
    await screen.getByLabelText('Time it happened').fill('late morning')
    await screen.getByLabelText('Where', { exact: true }).fill('home')
    await screen.getByLabelText('Originally written', { exact: true }).fill('1994-06-12')
    await screen.getByLabelText('Time it was originally written').fill('evening')
    await screen.getByLabelText('Written in', { exact: true }).fill('paper journal')
    await screen.getByLabelText('More about what it was written in').fill('blue Moleskine')

    // Leaving is not discarding: the session is let go, and what it held stays a draft.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    screen.unmount()

    expect(abandonDraft).toHaveBeenCalledOnce()
    await abandonDraft.mock.results[0]!.value
    const [draft] = await draftRepository.list()
    expect(draft?.entry.title).toBe('Lake Tahoe')
    expect(docToPlainText(draft!.entry.content)).toBe('We drove up on Friday.')
    expect(draft?.entry.dates).toEqual({
      occurred_at: '1994-06-11',
      occurred_time_note: 'late morning',
      recorded_at: '1994-06-12',
      recorded_time_note: 'evening',
    })
    expect(draft?.entry.location).toBe('home')
    expect(draft?.entry.original_medium).toBe('paper journal')
    expect(draft?.entry.original_medium_note).toBe('blue Moleskine')
  })

  it('drops a draft whose words are all deleted', async () => {
    const screen = await mountAt(NewEntryView)
    await screen.getByRole('textbox', { name: 'New entry' }).fill('Lake Tahoe')
    // On disk with its words first, so there is a row for deleting them to remove.
    await vi.waitFor(async () => {
      expect(await draftRepository.list()).toHaveLength(1)
    })

    await screen.getByRole('textbox', { name: 'New entry' }).click()
    await userEvent.keyboard('{Control>}a{/Control}{Backspace}')
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    screen.unmount()

    // Resolves once the session's flush has landed.
    await abandonDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
  })

  it('says why an entry with nothing written can’t be saved, even with a title', async () => {
    const screen = await mountAt(NewEntryView)
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
