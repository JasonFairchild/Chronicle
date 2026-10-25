import App from '@/App.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft } from '@/testing/draftFixtures'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView flows', () => {
  it('resumes a draft on the page it was started from', () => {
    cy.then(() =>
      draftRepository.save(
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
      ),
    )
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('link', { name: 'Resume' }).click()

    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'Half a thought')
  })

  it('discards a draft on request, the one thing that removes work', () => {
    cy.then(() =>
      draftRepository.save(
        makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
      ),
    )
    cy.mount(App, { routePath: '/drafts' })

    cy.findByText('Never mind').should('be.visible')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')
    cy.then(async () => {
      expect(await entryRepository.listRootEntries()).to.have.length(0)
    })
  })
})
