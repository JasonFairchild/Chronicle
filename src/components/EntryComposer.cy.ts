import { createPinia, setActivePinia } from 'pinia'
import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'

/** A new entry's session, begun the way a view begins one before mounting the composer. */
function beginSession() {
  setActivePinia(createPinia())
  const session = useDraftSession()
  session.begin({ kind: 'new_root' })
  return session
}

describe('EntryComposer', () => {
  it('says why an entry with nothing written can’t be saved, even with a title', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy().as('onSave'), onDiscard: cy.spy() },
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
    cy.get('@onSave').should('not.have.been.called')

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.get('@onSave').should('have.been.calledOnce')
  })

  it('says why a save or a discard failed, until the next change', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: {
        onSave: cy.stub().rejects(new Error('seal rejected')),
        onDiscard: cy.stub().rejects(new Error('discard rejected')),
      },
    })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('have.text', 'seal rejected')

    cy.findByRole('textbox', { name: 'New entry' }).type(' Saturday, actually.')
    cy.findByRole('alert').should('not.exist')

    cy.findByRole('button', { name: 'Discard' }).click()
    cy.findByRole('alert').should('have.text', 'discard rejected')
  })
})
