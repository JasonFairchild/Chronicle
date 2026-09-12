import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import NewConnectionView from '@/views/NewConnectionView.vue'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { textContent } from '@/domain/entryDocument'
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
  let repository: DexieEntryRepository
  let drafts: DexieDraftRepository

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
    const editor = screen.getByRole('textbox', { name: 'New connection' })
    await editor.getByRole('heading').click()
    await userEvent.keyboard('Led to it')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('entry-detail')
    })

    const [connection] = await repository.listConnectionsFor(source.id)
    expect(connection?.title).toBe('Led to it')
    expect(connection?.occurred_at).toBe('2020-01-01')
    expect(connection?.parent_id).toBe(source.id)
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

    // Picking a target begins a real draft session. Discarding it and waiting for that to land
    // keeps the write from racing this test's own isolated database being torn down afterward.
    await screen.getByRole('button', { name: 'Discard' }).click()
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
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
