import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewConnectionView from '@/views/NewConnectionView.vue'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import { textContent } from '@/domain/entryDocument'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { createEntryInput } from '@/types/entry'

async function mountNewConnection(id: string) {
  const router = createTestRouter()
  await router.push({ name: 'new-connection', params: { id } })
  await router.isReady()

  const screen = renderComponent(NewConnectionView, {
    props: { id },
    global: { plugins: [router] },
  })
  return { screen, router }
}

describe('NewConnectionView (browser)', () => {
  let repository: EntryRepository
  let drafts: DraftRepository

  beforeEach(() => {
    repository = freshEntryRepository()
    drafts = freshDraftRepository()
  })

  it('creates a connection with a title, dates, and rich content, then returns to the source entry', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const { screen, router } = await mountNewConnection(source.id)
    await expect.element(screen.getByText(/New connection from/)).toBeVisible()

    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByLabelText('Happened', { exact: true }).fill('2020-01-01')
    await screen.getByRole('textbox', { name: 'Title' }).fill('Led to it')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('entry-detail')
    })

    const [connection] = await repository.listConnectionsFor(source.id)
    expect(connection?.title).toBe('Led to it')
    expect(connection?.dates.occurred_at).toBe('2020-01-01')
    expect(connection?.parent_id).toBe(source.id)
    expect(connection?.target_id).toBe(destination.id)
  })

  it('adds an untitled connection', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const { screen, router } = await mountNewConnection(source.id)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)

    // A connection can be as light as noticing two things share something. Making it name that
    // recognition before it can be recorded would stop most of them from being made at all.
    await screen.getByRole('textbox', { name: 'New connection' }).fill('These rhyme.')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    // Waiting on the post-save navigation, not just the row: sealing writes and then routes away,
    // and reading the repository before that settles races this test's database being torn down.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('entry-detail')
    })

    const [connection] = await repository.listConnectionsFor(source.id)
    expect(connection?.title).toBeNull()
    expect(connection?.target_id).toBe(destination.id)
  })

  it('will not add a connection with no content', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const { screen } = await mountNewConnection(source.id)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)

    await expect.element(screen.getByRole('button', { name: 'Add connection' })).toBeDisabled()
  })

  it('keeps a half-written connection when the screen is left without discarding it', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const { screen } = await mountNewConnection(source.id)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByRole('textbox', { name: 'New connection' }).fill('These rhyme, somehow')

    // Navigating away is not discarding. Only the Discard button throws work away.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    screen.unmount()

    // `reset()` abandons the session fire-and-forget; this resolves once its flush lands.
    expect(abandonDraft).toHaveBeenCalledOnce()
    await abandonDraft.mock.results[0]!.value
    const [draft] = await drafts.list()
    expect(draft).toMatchObject({
      kind: 'new_connection',
      parent_id: source.id,
      target_id: destination.id,
    })
  })

  it('discards a half-written connection on request', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const { screen } = await mountNewConnection(source.id)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByRole('textbox', { name: 'New connection' }).fill('These rhyme, somehow')
    // A connection claims nothing, so only typing puts a row on disk for Discard to remove.
    await vi.waitFor(async () => {
      expect(await drafts.list()).toHaveLength(1)
    })

    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()

    // Resolves once the delete has landed.
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
    expect(await drafts.list()).toEqual([])
  })

  it('says there is nothing to connect to rather than showing an empty picker', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )

    const { screen } = await mountNewConnection(source.id)

    await expect
      .element(
        screen.getByText('There is nothing else to connect to yet. Write another entry first.'),
      )
      .toBeVisible()
  })
})
