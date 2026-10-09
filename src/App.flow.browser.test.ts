import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

async function mountApp(path: string) {
  const router = createTestRouter()
  await router.push(path)
  await router.isReady()

  return renderComponent(App, { global: { plugins: [router] } })
}

/**
 * Another tab: its own stores over the same database, made active so `useDraftsStore()` reaches
 * them rather than the mounted app's.
 */
function openOtherTab() {
  setActivePinia(createPinia())
  return useDraftsStore()
}

/**
 * Hides or shows this tab as the browser would. `visibilityState` is a read-only getter on
 * `Document.prototype`, so an own property on `document` shadows it until `afterEach` deletes it.
 */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('App flows (browser)', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('shows what another tab wrote to the open draft once this tab is returned to', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountApp('/drafts')
    await screen.getByRole('button', { name: 'Resume' }).click()
    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Half a thought')

    // Carried on in another tab while this one sat in the background.
    const otherTab = openOtherTab()
    await otherTab.resumeDraft('session-1')
    otherTab.recordChange('session-1', {
      content: textContent('Half a thought, carried on elsewhere'),
      steps: [{ stepType: 'replace' }],
    })
    await otherTab.flush('session-1')
    window.dispatchEvent(new Event('focus'))

    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Half a thought, carried on elsewhere')
  })

  it('shows what another tab wrote to the open draft once this tab is shown again', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountApp('/drafts')
    await screen.getByRole('button', { name: 'Resume' }).click()
    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Half a thought')

    // On a phone, switching back to an app can show the tab without focusing its window.
    setVisibility('hidden')
    const otherTab = openOtherTab()
    await otherTab.resumeDraft('session-1')
    otherTab.recordChange('session-1', {
      content: textContent('Half a thought, carried on elsewhere'),
      steps: [{ stepType: 'replace' }],
    })
    await otherTab.flush('session-1')
    setVisibility('visible')

    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Half a thought, carried on elsewhere')
  })

  it('closes the open draft and says so once another tab has saved it', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountApp('/drafts')
    await screen.getByRole('button', { name: 'Resume' }).click()
    await expect.element(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible()

    const otherTab = openOtherTab()
    await otherTab.resumeDraft('session-1')
    await otherTab.sealDraft('session-1')
    window.dispatchEvent(new Event('focus'))

    await expect
      .element(screen.getByText('This draft was saved or discarded elsewhere.'))
      .toBeVisible()
    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })

  it('writes what was typed at once when the tab is left', async () => {
    const screen = await mountApp('/')
    await screen.getByRole('textbox', { name: 'New entry' }).click()
    await userEvent.keyboard('We drove up on Friday.')

    // Leaving may be the last chance: a closed tab never fires the flush timer.
    const flushAll = vi.spyOn(useDraftsStore(), 'flushAll')
    window.dispatchEvent(new Event('pagehide'))

    expect(flushAll).toHaveBeenCalledOnce()
    await flushAll.mock.results[0]!.value
    const [draft] = await draftRepository.list()
    expect(docToPlainText(draft!.entry.content)).toBe('We drove up on Friday.')
  })

  it('writes what was typed at once when the tab is hidden', async () => {
    const screen = await mountApp('/')
    await screen.getByRole('textbox', { name: 'New entry' }).click()
    await userEvent.keyboard('We drove up on Friday.')

    // On a phone, a hidden tab may be killed without `pagehide` ever firing.
    const flushAll = vi.spyOn(useDraftsStore(), 'flushAll')
    setVisibility('hidden')

    expect(flushAll).toHaveBeenCalledOnce()
    await flushAll.mock.results[0]!.value
    const [draft] = await draftRepository.list()
    expect(docToPlainText(draft!.entry.content)).toBe('We drove up on Friday.')
  })
})
