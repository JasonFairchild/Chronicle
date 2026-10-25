import { describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft } from '@/testing/draftFixtures'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts the app behind a real router already at the Drafts page. */
async function mountApp() {
  const router = createTestRouter()
  await router.push('/drafts')
  await router.isReady()

  return renderComponent(App, { global: { plugins: [router] } })
}

describe('DraftsView flows (browser)', () => {
  it('resumes a draft on the page it was started from', async () => {
    await draftRepository.save(
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )

    const screen = await mountApp()
    await screen.getByRole('link', { name: 'Resume' }).click()

    await expect
      .element(screen.getByRole('textbox', { name: 'New entry' }))
      .toHaveTextContent('Half a thought')
  })

  it('discards a draft on request, the one thing that removes work', async () => {
    await draftRepository.save(
      makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
    )

    const screen = await mountApp()
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
    expect(await entryRepository.listRootEntries()).toEqual([])
  })
})
