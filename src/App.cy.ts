import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

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
  cy.document().then((doc) => {
    Object.defineProperty(doc, 'visibilityState', { value: state, configurable: true })
    doc.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('App', () => {
  afterEach(() => {
    cy.document().then((doc) => Reflect.deleteProperty(doc, 'visibilityState'))
  })

  it('shows what another tab wrote to the open draft once this tab is returned to', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
      ),
    )
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('textbox', { name: 'Draft' }).should('contain.text', 'Half a thought')

    // Carried on in another tab while this one sat in the background.
    cy.then(async () => {
      const otherTab = openOtherTab()
      await otherTab.resumeDraft('session-1')
      otherTab.recordChange('session-1', {
        content: textContent('Half a thought, carried on elsewhere'),
        steps: [{ stepType: 'replace' }],
      })
      await otherTab.flush('session-1')
    })
    cy.window().then((win) => win.dispatchEvent(new Event('focus')))

    cy.findByRole('textbox', { name: 'Draft' }).should(
      'contain.text',
      'Half a thought, carried on elsewhere',
    )
  })

  it('shows what another tab wrote to the open draft once this tab is shown again', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
      ),
    )
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('textbox', { name: 'Draft' }).should('contain.text', 'Half a thought')

    // On a phone, switching back to an app can show the tab without focusing its window.
    setVisibility('hidden')
    cy.then(async () => {
      const otherTab = openOtherTab()
      await otherTab.resumeDraft('session-1')
      otherTab.recordChange('session-1', {
        content: textContent('Half a thought, carried on elsewhere'),
        steps: [{ stepType: 'replace' }],
      })
      await otherTab.flush('session-1')
    })
    setVisibility('visible')

    cy.findByRole('textbox', { name: 'Draft' }).should(
      'contain.text',
      'Half a thought, carried on elsewhere',
    )
  })

  it('closes the open draft and says so once another tab has saved it', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
      ),
    )
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('textbox', { name: 'Draft' }).should('be.visible')

    cy.then(async () => {
      const otherTab = openOtherTab()
      await otherTab.resumeDraft('session-1')
      await otherTab.sealDraft('session-1')
    })
    cy.window().then((win) => win.dispatchEvent(new Event('focus')))

    cy.findByText('This draft was saved or discarded elsewhere.').should('be.visible')
    cy.findByText('No drafts in progress.').should('be.visible')
  })

  it('writes what was typed at once when the tab is left', () => {
    cy.mount(App, { routePath: '/' })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    // Leaving may be the last chance: a closed tab never fires the flush timer.
    cy.window().then(async (win) => {
      const flushAll = cy.spy(useDraftsStore(), 'flushAll')
      win.dispatchEvent(new Event('pagehide'))

      expect(flushAll).to.have.callCount(1)
      await flushAll.firstCall.returnValue
      const [draft] = await draftRepository.list()
      expect(docToPlainText(draft!.entry.content)).to.equal('We drove up on Friday.')
    })
  })

  it('writes what was typed at once when the tab is hidden', () => {
    cy.mount(App, { routePath: '/' })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    // On a phone, a hidden tab may be killed without `pagehide` ever firing.
    cy.then(() => {
      cy.spy(useDraftsStore(), 'flushAll').as('flushAll')
    })
    setVisibility('hidden')

    cy.get('@flushAll')
      .should('have.been.calledOnce')
      .then((flushAll) => flushAll.firstCall.returnValue)
    cy.then(async () => {
      const [draft] = await draftRepository.list()
      expect(docToPlainText(draft!.entry.content)).to.equal('We drove up on Friday.')
    })
  })
})
