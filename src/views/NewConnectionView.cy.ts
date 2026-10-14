import type { Router } from 'vue-router'
import NewConnectionView from '@/views/NewConnectionView.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'
import { createTestRouter } from '@/testing/testRouter'
import { createEntryInput } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

function mountNewConnection(
  id: string,
  { router, draft }: { router?: Router; draft?: string } = {},
): Cypress.Chainable {
  return cy.mount(NewConnectionView, {
    props: { id },
    routePath: `/entries/${id}/connect${draft ? `?draft=${draft}` : ''}`,
    router,
  })
}

describe('NewConnectionView', () => {
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
      mountNewConnection(source.id, { router })

      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByRole('button', { name: 'Discard' }).click()

      cy.wrap(router)
        .its('currentRoute.value')
        .should('deep.include', { name: 'entry-detail', params: { id: source.id } })
    })
  })

  it('reopens the connection it was linked to, with the entry it connects to', () => {
    cy.then(async () => {
      const source = await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      )
      const destination = await entryRepository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      )
      await seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: { content: textContent('One led to the other'), events: TYPED },
          kind: { kind: 'new_connection', parent_id: source.id, target_id: destination.id },
        }),
      )
      return { source, destination }
    }).then(({ source, destination }) => {
      mountNewConnection(source.id, { draft: 'session-1' })

      cy.findByRole('textbox', { name: 'New connection' }).should(
        'contain.text',
        'One led to the other',
      )
      cy.findByLabelText('Connect to').should('have.value', destination.id)
    })
  })
})
