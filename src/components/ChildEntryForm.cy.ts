import ChildEntryForm from '@/components/ChildEntryForm.vue'

function mountForm(quote: string | null) {
  const onSubmit = cy.stub().as('submit')

  // Listeners go in `attrs`, matching how a parent uses `@submit`; `props` is for real props.
  cy.mount(ChildEntryForm, {
    props: { quote },
    attrs: { onSubmit },
  })
}

describe('ChildEntryForm', () => {
  it('says the note is about the whole entry when nothing is selected', () => {
    mountForm(null)

    cy.findByText(/About this entry as a whole/).should('be.visible')
  })

  it('shows the selected passage when there is one', () => {
    mountForm('Lake Tahoe')

    cy.findByText('“Lake Tahoe”').should('be.visible')
  })

  it('offers no strike action without a selection, since there is nothing to strike', () => {
    mountForm(null)

    cy.findByRole('combobox', { name: 'Anchor action' }).should('not.exist')
  })

  it('emits an annotation comment by default', () => {
    mountForm('Lake Tahoe')

    cy.findByLabelText('Your note').type('Worth remembering')
    cy.findByRole('button', { name: 'Add entry' }).click()

    cy.get('@submit').should('have.been.calledOnceWith', {
      relationType: 'annotation',
      opKind: 'comment',
      content: 'Worth remembering',
      insertion: '',
    })
  })

  it('carries replacement wording alongside a strike', () => {
    mountForm('Lake Tahoe')

    cy.findByRole('combobox', { name: 'Relation type' }).select('update')
    cy.findByRole('combobox', { name: 'Anchor action' }).select('strike')
    cy.findByLabelText('Your note').type('Wrong lake')
    cy.findByLabelText('Replacement wording').type('Donner Lake')
    cy.findByRole('button', { name: 'Add entry' }).click()

    cy.get('@submit').should('have.been.calledOnceWith', {
      relationType: 'update',
      opKind: 'strike',
      content: 'Wrong lake',
      insertion: 'Donner Lake',
    })
  })

  it('asks for replacement wording only once a strike is chosen', () => {
    mountForm('Lake Tahoe')

    cy.findByLabelText('Replacement wording').should('not.exist')
    cy.findByRole('combobox', { name: 'Anchor action' }).select('strike')
    cy.findByLabelText('Replacement wording').should('be.visible')
  })

  it('refuses to submit an empty note', () => {
    mountForm(null)

    cy.findByRole('button', { name: 'Add entry' }).should('be.disabled')
    cy.get('@submit').should('not.have.been.called')
  })

  it('clears itself after a successful submission', () => {
    mountForm(null)

    cy.findByLabelText('Your note').type('Something')
    cy.findByRole('button', { name: 'Add entry' }).click()

    cy.findByLabelText('Your note').should('have.value', '')
  })
})
