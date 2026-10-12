import NewEntryView from '@/views/NewEntryView.vue'
import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { createTestRouter } from '@/testing/testRouter'

describe('NewEntryView', () => {
  it('lands on the entry it saves', () => {
    const router = createTestRouter()
    cy.mount(NewEntryView, { routePath: '/entries/new', router })
    cy.then(() => {
      cy.spy(useDraftsStore(), 'sealDraft').as('sealDraft')
    })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.get('@sealDraft')
      .should('have.been.calledOnce')
      .then((sealDraft) => sealDraft.firstCall.returnValue)
      .then((saved) => {
        cy.wrap(router)
          .its('currentRoute.value')
          .should('deep.include', { name: 'entry-detail', params: { id: saved.id } })
      })
  })

  it('keeps what was written, and says why, when the save fails', () => {
    const router = createTestRouter()
    cy.stub(draftRepository, 'seal').rejects(new Error('seal rejected'))
    cy.mount(NewEntryView, { routePath: '/entries/new', router })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('alert').should('have.text', 'seal rejected')
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'We drove up on Friday.')
    cy.wrap(router).its('currentRoute.value.name').should('equal', 'new-entry')
    cy.findByRole('button', { name: 'Save entry' }).should('be.enabled')
  })

  it('empties the page on Discard, ready for the next entry', () => {
    cy.mount(NewEntryView, { routePath: '/entries/new' })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.findByText('We drove up on Friday.').should('not.exist')
  })
})
