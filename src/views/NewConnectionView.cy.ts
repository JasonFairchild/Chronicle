import NewConnectionView from '@/views/NewConnectionView.vue'
import { textContent } from '@/domain/entryDocument'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import type { DraftSummary } from '@/types/draft'
import { createEntryInput } from '@/types/entry'

function mountNewConnection(id: string): Cypress.Chainable {
  return cy.mount(NewConnectionView, { props: { id }, routePath: `/entries/${id}/connect` })
}

let repository: DexieEntryRepository
let drafts: DexieDraftRepository

describe('NewConnectionView', () => {
  beforeEach(() => {
    repository = freshEntryRepository()
    drafts = freshDraftRepository()
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
        cy.findByRole('textbox', { name: 'Title' }).type('Led to it')
        cy.findByRole('button', { name: 'Add connection' }).click()

        // Not checking the resulting route here: `cy.mount`'s router runs on in-memory history,
        // which never touches the real address bar `cy.location()` reads — see
        // EntryDetailView.cy.ts for the same limitation. The Vitest browser spec checks the
        // post-save route directly against the router instance it built itself.
        cy.then(() => repository.listConnectionsFor(source.id)).then((connections) => {
          expect(connections[0]?.title).to.equal('Led to it')
          expect(connections[0]?.dates.occurred_at).to.equal('2020-01-01')
          expect(connections[0]?.parent_id).to.equal(source.id)
          expect(connections[0]?.target_id).to.equal(destination.id)
        })
      })
    })
  })

  it('adds an untitled connection', () => {
    cy.then(() =>
      repository.create(createEntryInput({ content: textContent('Left my job') })),
    ).then((source) => {
      cy.then(() =>
        repository.create(createEntryInput({ content: textContent('Started the degree') })),
      ).then((destination) => {
        mountNewConnection(source.id)

        cy.findByLabelText('Connect to').select(destination.id)

        // A connection can be as light as noticing two things share something. Making it name that
        // recognition before it can be recorded would stop most of them from being made at all.
        cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme.')
        cy.findByRole('button', { name: 'Add connection' }).click()

        cy.then(() => repository.listConnectionsFor(source.id)).then((connections) => {
          expect(connections[0]?.title).to.equal(null)
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

  it('keeps a half-written connection when the screen is left without discarding it', () => {
    cy.then(() =>
      repository.create(createEntryInput({ content: textContent('Left my job') })),
    ).then((source) => {
      cy.then(() =>
        repository.create(createEntryInput({ content: textContent('Started the degree') })),
      ).then((destination) => {
        mountNewConnection(source.id).then(({ wrapper }) => {
          cy.findByLabelText('Connect to').select(destination.id)
          cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme, somehow')

          // Navigating away is not discarding. Only the Discard button throws work away.
          cy.then(() => wrapper.unmount())
        })

        // `reset()` abandons the session fire-and-forget (`useDraftSession.reset`), so the write
        // isn't necessarily done the instant `unmount()` returns — poll rather than assume.
        cy.then(function waitForSavedDraft(): Promise<DraftSummary[]> {
          return drafts
            .list()
            .then((saved) =>
              saved.length > 0 ? saved : Cypress.Promise.delay(50).then(waitForSavedDraft),
            )
        }).then((saved) => {
          expect(saved[0]?.target).to.deep.equal({
            kind: 'new_connection',
            parent_id: source.id,
            target_id: destination.id,
          })
        })
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
