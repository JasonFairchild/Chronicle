import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

import { draftRepository, entryRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { createEntryInput } from '@/types/entry'
import NewConnectionView from '@/views/NewConnectionView.vue'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

async function mountNewConnection(
  id: string,
  { router = createTestRouter(), draft }: { router?: Router; draft?: string } = {},
) {
  await router.push({ name: 'new-connection', params: { id }, query: { draft } })
  await router.isReady()

  return renderComponent(NewConnectionView, {
    props: { id },
    global: { plugins: [router] },
  })
}

describe('NewConnectionView (browser)', () => {
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

  it('returns to the entry it started from on Discard', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const router = createTestRouter()
    const screen = await mountNewConnection(source.id, { router })

    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByRole('button', { name: 'Discard' }).click()

    await vi.waitFor(() => {
      expect(router.currentRoute.value).toMatchObject({
        name: 'entry-detail',
        params: { id: source.id },
      })
    })
  })

  it('reopens the connection it was linked to, with the entry it connects to', async () => {
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const destination = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    await draftRepository.save(
      makeDraft('session-1', {
        entry: { content: textContent('One led to the other'), events: TYPED },
        kind: { kind: 'new_connection', parent_id: source.id, target_id: destination.id },
      }),
    )

    const screen = await mountNewConnection(source.id, { draft: 'session-1' })

    await expect
      .element(screen.getByRole('textbox', { name: 'New connection' }))
      .toHaveTextContent('One led to the other')
    await expect.element(screen.getByLabelText('Connect to')).toHaveValue(destination.id)
  })
})
