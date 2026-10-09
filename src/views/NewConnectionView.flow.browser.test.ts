import { describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { createEntryInput } from '@/types/entry'

async function mountApp(path: string) {
  const router = createTestRouter()
  await router.push(path)
  await router.isReady()

  return renderComponent(App, { global: { plugins: [router] } })
}

describe('NewConnectionView flows (browser)', () => {
  it('creates a connection with a title, dates, and rich content, then lands on its own page', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const screen = await mountApp(`/entries/${source.id}/connect`)
    await expect.element(screen.getByText(/New connection from/)).toBeVisible()

    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByLabelText('Happened', { exact: true }).fill('2020-01-01')
    await screen.getByRole('textbox', { name: 'Title' }).fill('Led to it')
    await screen
      .getByRole('textbox', { name: 'New connection' })
      .fill('The layoff made room for it.')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    await expect.element(screen.getByRole('heading', { name: 'Led to it' })).toBeVisible()
    await expect
      .element(screen.getByRole('article'))
      .toHaveTextContent('The layoff made room for it.')
    await expect.element(screen.getByText(/Happened .*2020/)).toBeVisible()
    await expect.element(screen.getByText('Connects', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: 'Left my job' }))
      .toHaveAttribute('href', `/entries/${source.id}`)
    await expect
      .element(screen.getByRole('link', { name: 'Started the degree' }))
      .toHaveAttribute('href', `/entries/${destination.id}`)
  })

  it('adds an untitled connection', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const screen = await mountApp(`/entries/${source.id}/connect`)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)

    // A connection can be as light as noticing two things share something. Making it name that
    // recognition before it can be recorded would stop most of them from being made at all.
    await screen.getByRole('textbox', { name: 'New connection' }).fill('These rhyme.')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    // The composer closes only once the save has landed.
    await expect
      .element(screen.getByRole('textbox', { name: 'New connection' }))
      .not.toBeInTheDocument()

    const [connection] = await entryRepository.listConnectionsFor(source.id)
    expect(connection?.title).toBeNull()
    expect(connection?.target_id).toBe(destination.id)
  })

  it('keeps a half-written connection when the screen is left without discarding it', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const screen = await mountApp(`/entries/${source.id}/connect`)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByRole('textbox', { name: 'New connection' }).fill('These rhyme, somehow')

    // Navigating away is not discarding. Only the Discard button throws work away.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.getByRole('link', { name: 'Timeline' }).click()

    // `reset()` abandons the session fire-and-forget; this resolves once its flush lands.
    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
    await abandonDraft.mock.results[0]!.value
    const [draft] = await draftRepository.list()
    expect(draft).toMatchObject({
      kind: 'new_connection',
      parent_id: source.id,
      target_id: destination.id,
    })
  })

  it('discards a half-written connection on request', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const screen = await mountApp(`/entries/${source.id}/connect`)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByRole('textbox', { name: 'New connection' }).fill('These rhyme, somehow')
    // A connection claims nothing, so only typing puts a row on disk for Discard to remove.
    await vi.waitFor(async () => {
      expect(await draftRepository.list()).toHaveLength(1)
    })

    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()

    // Resolves once the delete has landed.
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
  })
})
