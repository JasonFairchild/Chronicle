import NewConnectionView from '@/views/NewConnectionView.vue'
import { textContent } from '@/domain/entryDocument'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { createEntryInput } from '@/types/entry'

function mountNewConnection(id: string): void {
  cy.mount(NewConnectionView, { props: { id }, routePath: `/entries/${id}/connect` })
}

let repository: DexieEntryRepository

describe('NewConnectionView', () => {
  beforeEach(() => {
    repository = freshEntryRepository()
    freshDraftRepository()
  })

  it('creates a connection with a title, dates, and rich content, then returns to the source entry', () => {
    cy.then(() =>
      repository.create(createEntryInput({ content: textContent('Left my job') })),
    ).then((source) => {
      cy.then(() =>
        repository.create(createEntryInput({ content: textContent('Started the degree') })),
      ).then((destination) => {
        mountNewConnection(source.id)

        cy.findByText(/New connection from/).should('be.visible')

        cy.findByLabelText('Connect to').select(destination.id)
        cy.findByLabelText('Happened').type('2020-01-01')
        // Scoped to the editor rather than matched by name: the page's own "New connection
        // from..." heading is also an <h1>, so an unscoped role query would be ambiguous.
        cy.findByRole('textbox', { name: 'New connection' }).findByRole('heading').click()
        cy.focused().type('Led to it')
        cy.findByRole('button', { name: 'Add connection' }).click()

        // Not checking the resulting route here: `cy.mount`'s router runs on in-memory history,
        // which never touches the real address bar `cy.location()` reads — see
        // EntryDetailView.cy.ts for the same limitation. The Vitest browser spec checks the
        // post-save route directly against the router instance it built itself.
        cy.then(() => repository.listConnectionsFor(source.id)).then((connections) => {
          expect(connections[0]?.title).to.equal('Led to it')
          expect(connections[0]?.occurred_at).to.equal('2020-01-01')
          expect(connections[0]?.parent_id).to.equal(source.id)
          expect(connections[0]?.target_id).to.equal(destination.id)
        })
      })
    })
  })

  it('will not add a connection with no content', () => {
    cy.then(() =>
      repository.create(createEntryInput({ content: textContent('Left my job') })),
    ).then((source) => {
      cy.then(() =>
        repository.create(createEntryInput({ content: textContent('Started the degree') })),
      ).then((destination) => {
        mountNewConnection(source.id)

        cy.findByLabelText('Connect to').select(destination.id)
        cy.findByRole('button', { name: 'Add connection' }).should('be.disabled')

        // Picking a target begins a real draft session. Discarding it here, rather than leaving
        // it for unmount to clean up fire-and-forget, keeps that write from racing this test's
        // own isolated database being torn down right after.
        cy.findByRole('button', { name: 'Discard' }).click()
      })
    })
  })

  it('says there is nothing to connect to rather than showing an empty picker', () => {
    cy.then(() =>
      repository.create(createEntryInput({ content: textContent('Left my job') })),
    ).then((source) => {
      mountNewConnection(source.id)

      cy.findByText('There is nothing else to connect to yet. Write another entry first.').should(
        'be.visible',
      )
    })
  })
})
