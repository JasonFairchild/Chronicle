import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { textContent } from '@/testing/documents'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts the app behind a real router already at `path`, the new-entry page unless given. */
async function mountApp({ router = createTestRouter(), path = '/entries/new' } = {}) {
  await router.push(path)
  await router.isReady()

  return renderComponent(App, { global: { plugins: [router] } })
}

describe('NewEntryView flows (browser)', () => {
  it('holds what is written as a draft until it is saved, then lands on the entry, details and all', async () => {
    const screen = await mountApp()

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
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
    expect(await entryRepository.listRootEntries()).toEqual([])

    await screen.getByRole('button', { name: 'Save entry' }).click()

    await expect.element(screen.getByRole('heading', { name: 'Lake Tahoe' })).toBeVisible()
    await expect.element(screen.getByRole('article')).toHaveTextContent('We drove up on Friday.')
    await expect.element(screen.getByText(/Happened .*1994 · late morning/)).toBeVisible()
    await expect.element(screen.getByText('Where: home', { exact: true })).toBeVisible()
    // Not asked for, so not invented.
    await expect.element(screen.getByText(/^Originally written .*1994$/)).toBeVisible()
    await expect
      .element(screen.getByText('Written in paper journal · blue Moleskine', { exact: true }))
      .toBeVisible()

    const [saved] = await entryRepository.listRootEntries()
    expect(saved?.authoring_trace?.events.length).toBeGreaterThan(0)
    // The buffer is working space, so sealing discards it rather than leaving a duplicate behind.
    expect(await draftRepository.list()).toEqual([])
  })

  it('saves an entry that was never given a title', async () => {
    const screen = await mountApp()

    // The title field is offered and skipped. A daily journal is mostly entries nobody would name,
    // and a required title there produces filler rather than better names.
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await expect.element(screen.getByRole('article')).toHaveTextContent('We drove up on Friday.')
    const [saved] = await entryRepository.listRootEntries()
    expect(saved?.title).toBeNull()
  })

  it('throws a draft away on Discard and starts over empty', async () => {
    const screen = await mountApp()

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
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

  it('reopens what was typed after a reload', async () => {
    const router = createTestRouter()
    const screen = await mountApp({ router })
    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')

    // A reload: written out as App does for a tab being left, then the same address afresh. Read
    // before unmounting, which returns the router to its start.
    await useDraftsStore().flushAll()
    const address = router.currentRoute.value.fullPath
    screen.unmount()
    const reloaded = await mountApp({ path: address })

    await expect.element(reloaded.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    await expect
      .element(reloaded.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('We drove up on Friday.')
  })

  it('leaves no draft behind for a page that was only opened', async () => {
    const screen = await mountApp()
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.getByRole('link', { name: 'Timeline' }).click()

    // Resolves once the session's flush has landed, so an empty draft would be on disk by now.
    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
    await abandonDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
  })

  it('keeps what was typed, details and all, when the page is left without saving', async () => {
    const screen = await mountApp()
    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await screen.getByLabelText('Happened', { exact: true }).fill('1994-06-11')
    await screen.getByLabelText('Time it happened').fill('late morning')
    await screen.getByLabelText('Where', { exact: true }).fill('home')
    await screen.getByLabelText('Originally written', { exact: true }).fill('1994-06-12')
    await screen.getByLabelText('Time it was originally written').fill('evening')
    await screen.getByLabelText('Written in', { exact: true }).fill('paper journal')
    await screen.getByLabelText('More about what it was written in').fill('blue Moleskine')

    // Leaving is not discarding: the session is let go, and what it held stays a draft.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.getByRole('link', { name: 'Timeline' }).click()

    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
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
    const screen = await mountApp()
    await screen.getByRole('textbox', { name: 'New entry' }).fill('Lake Tahoe')
    // On disk with its words first, so there is a row for deleting them to remove.
    await vi.waitFor(async () => {
      expect(await draftRepository.list()).toHaveLength(1)
    })

    await screen.getByRole('textbox', { name: 'New entry' }).click()
    await userEvent.keyboard('{Control>}a{/Control}{Backspace}')
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.getByRole('link', { name: 'Timeline' }).click()

    // Resolves once the session's flush has landed.
    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
    await abandonDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
  })

  it('keeps the version another tab saved first, and shows what this one had to copy', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountApp({ path: '/entries/new?draft=session-1' })
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
    const stored = await draftRepository.getById('session-1')
    expect(docToPlainText(stored!.entry.content)).toBe('Half a thought, finished elsewhere')
  })
})
