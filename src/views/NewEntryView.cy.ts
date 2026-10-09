import NewEntryView from '@/views/NewEntryView.vue'
import { useDraftsStore } from '@/stores/draftsStore'

describe('NewEntryView', () => {
  it('says why an entry with nothing written can’t be saved, even with a title', () => {
    cy.mount(NewEntryView, { routePath: '/entries/new' })
    cy.then(() => {
      cy.spy(useDraftsStore(), 'sealDraft').as('sealDraft')
    })

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should(
      'have.text',
      'Write something in the entry first. A title alone can’t be saved.',
    )

    // Any change answers it, even one that still leaves nothing written: a title names an entry
    // without being one, and spaces say nothing.
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('   ')
    cy.findByRole('alert').should('not.exist')

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('be.visible')
    cy.get('@sealDraft').should('not.have.been.called')
  })
})
