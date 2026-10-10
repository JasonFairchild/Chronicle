import type { Router } from 'vue-router'
import NewConnectionView from '@/views/NewConnectionView.vue'
import { textContent } from '@/domain/entryDocument'
import { entryRepository } from '@/repositories'
import { createTestRouter } from '@/testing/testRouter'
import { createEntryInput } from '@/types/entry'

function mountNewConnection(id: string, router?: Router): Cypress.Chainable {
  return cy.mount(NewConnectionView, {
    props: { id },
    routePath: `/entries/${id}/connect`,
    router,
  })
}

describe('NewConnectionView', () => {
  it('says why a connection with no content can’t be added', () => {
    cy.then(async () => ({
      source: await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      ),
      destination: await entryRepository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      mountNewConnection(source.id)

      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByRole('button', { name: 'Add connection' }).click()

      cy.findByRole('alert').should(
        'have.text',
        'Write something in the entry first. A title alone can’t be saved.',
      )
    })
  })

  it('says there is nothing to connect to rather than showing an empty picker', () => {
    cy.then(() =>
      entryRepository.create(createEntryInput({ content: textContent('Left my job') })),
    ).then((source) => {
      mountNewConnection(source.id)

      cy.findByText('There is nothing else to connect to yet. Write another entry first.').should(
        'be.visible',
      )
    })
  })

  it('returns to the entry it started from on Discard', () => {
    cy.then(async () => ({
      source: await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      ),
      destination: await entryRepository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      const router = createTestRouter()
      mountNewConnection(source.id, router)

      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByRole('button', { name: 'Discard' }).click()

      cy.wrap(router)
        .its('currentRoute.value')
        .should('deep.include', { name: 'entry-detail', params: { id: source.id } })
    })
  })
})
