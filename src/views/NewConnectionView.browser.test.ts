import { describe, expect, it } from 'vitest'
import NewConnectionView from '@/views/NewConnectionView.vue'
import { textContent } from '@/domain/entryDocument'
import { entryRepository } from '@/repositories'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { createEntryInput } from '@/types/entry'

async function mountNewConnection(id: string) {
  const router = createTestRouter()
  await router.push({ name: 'new-connection', params: { id } })
  await router.isReady()

  return renderComponent(NewConnectionView, {
    props: { id },
    global: { plugins: [router] },
  })
}

describe('NewConnectionView (browser)', () => {
  it('says why a connection with no content can’t be added', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )

    const screen = await mountNewConnection(source.id)
    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByRole('button', { name: 'Add connection' }).click()

    await expect
      .element(
        screen.getByRole('alert').and(
          screen.getByText('Write something in the entry first. A title alone can’t be saved.', {
            exact: true,
          }),
        ),
      )
      .toBeVisible()
  })

  it('says there is nothing to connect to rather than showing an empty picker', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )

    const screen = await mountNewConnection(source.id)

    await expect
      .element(
        screen.getByText('There is nothing else to connect to yet. Write another entry first.'),
      )
      .toBeVisible()
  })
})
