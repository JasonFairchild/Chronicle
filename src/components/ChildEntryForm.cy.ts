import ChildEntryForm from '@/components/ChildEntryForm.vue'

function mountForm() {
  const onSubmit = cy.stub().as('submit')

  // Listeners go in `attrs`, matching how a parent uses `@submit`.
  cy.mount(ChildEntryForm, { attrs: { onSubmit } })
}

describe('ChildEntryForm', () => {
  it('says the note is about the whole entry, pointing at anchoring for a specific passage', () => {
    mountForm()

    cy.findByText(/About this entry as a whole/).should('be.visible')
  })

  it('emits an annotation by default', () => {
    mountForm()

    cy.findByLabelText('Your note').type('Worth remembering')
    cy.findByRole('button', { name: 'Add entry' }).click()

    cy.get('@submit').should('have.been.calledOnceWith', {
      relationType: 'annotation',
      content: 'Worth remembering',
    })
  })

  it('emits the chosen relation kind', () => {
    mountForm()

    cy.findByRole('combobox', { name: 'Relation type' }).select('update')
    cy.findByLabelText('Your note').type('It changed since')
    cy.findByRole('button', { name: 'Add entry' }).click()

    cy.get('@submit').should('have.been.calledOnceWith', {
      relationType: 'update',
      content: 'It changed since',
    })
  })

  it('refuses to submit an empty note', () => {
    mountForm()

    cy.findByRole('button', { name: 'Add entry' }).should('be.disabled')
    cy.get('@submit').should('not.have.been.called')
  })

  it('clears itself after a successful submission', () => {
    mountForm()

    cy.findByLabelText('Your note').type('Something')
    cy.findByRole('button', { name: 'Add entry' }).click()

    cy.findByLabelText('Your note').should('have.value', '')
  })
})
