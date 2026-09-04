import EntryForm from '@/components/EntryForm.vue'

describe('EntryForm', () => {
  it('submits trimmed entry content', () => {
    const onSubmit = cy.stub().as('submit')

    cy.mount(EntryForm, {
      props: {
        onSubmit,
      },
    })

    cy.get('#entry-content').type('  Cypress component test  ')
    cy.contains('button', 'Save entry').click()

    cy.get('@submit').should('have.been.calledOnceWith', 'Cypress component test')
  })
})
