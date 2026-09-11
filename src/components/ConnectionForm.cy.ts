import ConnectionForm from '@/components/ConnectionForm.vue'

const CANDIDATES = [
  { id: 'entry-1', label: 'Started the degree' },
  { id: 'entry-2', label: 'Left my job' },
]

describe('ConnectionForm', () => {
  it('submits the destination along with why the two relate', () => {
    const onSubmit = cy.stub().as('submit')

    cy.mount(ConnectionForm, { props: { candidates: CANDIDATES }, attrs: { onSubmit } })

    cy.findByLabelText('Connect to').select('entry-2')
    cy.findByLabelText('How they relate').type('led_to')
    cy.findByLabelText('Why they relate').type('  One made the other possible  ')
    cy.findByRole('button', { name: 'Add connection' }).click()

    cy.get('@submit').should('have.been.calledOnceWith', {
      toId: 'entry-2',
      label: 'led_to',
      content: 'One made the other possible',
    })
  })

  it('treats the edge itself as the claim, so wording and note stay optional', () => {
    const onSubmit = cy.stub().as('submit')

    cy.mount(ConnectionForm, { props: { candidates: CANDIDATES }, attrs: { onSubmit } })

    cy.findByLabelText('Connect to').select('entry-1')
    cy.findByRole('button', { name: 'Add connection' }).click()

    cy.get('@submit').should('have.been.calledOnceWith', {
      toId: 'entry-1',
      label: '',
      content: '',
    })
  })

  it('refuses to submit without a destination, since direction is the point', () => {
    cy.mount(ConnectionForm, { props: { candidates: CANDIDATES } })

    cy.findByRole('button', { name: 'Add connection' }).should('be.disabled')
  })

  it('says there is nothing to connect to rather than showing an empty picker', () => {
    cy.mount(ConnectionForm, { props: { candidates: [] } })

    cy.findByText('There is nothing else to connect to yet. Write another entry first.').should(
      'be.visible',
    )
    cy.findByRole('button', { name: 'Add connection' }).should('not.exist')
  })
})
