import NewConnectionView from '@/views/NewConnectionView.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import { useDraftsStore } from '@/stores/draftsStore'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { createEntryInput } from '@/types/entry'

function mountNewConnection(id: string): Cypress.Chainable {
  return cy.mount(NewConnectionView, { props: { id }, routePath: `/entries/${id}/connect` })
}

let repository: EntryRepository
let drafts: DraftRepository

describe('NewConnectionView', () => {
  beforeEach(() => {
    repository = freshEntryRepository()
    drafts = freshDraftRepository()
  })

  it('creates a connection with a title, dates, and rich content, then returns to the source entry', () => {
    cy.then(async () => ({
      source: await repository.create(createEntryInput({ content: textContent('Left my job') })),
      destination: await repository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      mountNewConnection(source.id)

      cy.findByText(/New connection from/).should('be.visible')

      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByLabelText('Happened').type('2020-01-01')
      cy.findByRole('textbox', { name: 'Title' }).type('Led to it')
      cy.findByRole('textbox', { name: 'New connection' }).type('The layoff made room for it.')
      cy.findByRole('button', { name: 'Add connection' }).click()

      // Not checking the resulting route here: `cy.mount`'s router runs on in-memory history,
      // which never touches the real address bar `cy.location()` reads — see
      // EntryDetailView.cy.ts for the same limitation. The Vitest browser spec checks the
      // post-save route directly against the router instance it built itself. The composer
      // closes only once the save has landed.
      cy.findByRole('textbox', { name: 'New connection' }).should('not.exist')
      cy.then(() => repository.listConnectionsFor(source.id)).then((connections) => {
        expect(connections[0]?.title).to.equal('Led to it')
        expect(docToPlainText(connections[0]!.content)).to.equal('The layoff made room for it.')
        expect(connections[0]?.dates.occurred_at).to.equal('2020-01-01')
        expect(connections[0]?.parent_id).to.equal(source.id)
        expect(connections[0]?.target_id).to.equal(destination.id)
      })
    })
  })

  it('adds an untitled connection', () => {
    cy.then(async () => ({
      source: await repository.create(createEntryInput({ content: textContent('Left my job') })),
      destination: await repository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      mountNewConnection(source.id)

      cy.findByLabelText('Connect to').select(destination.id)

      // A connection can be as light as noticing two things share something. Making it name that
      // recognition before it can be recorded would stop most of them from being made at all.
      cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme.')
      cy.findByRole('button', { name: 'Add connection' }).click()

      // The composer closes only once the save has landed.
      cy.findByRole('textbox', { name: 'New connection' }).should('not.exist')
      cy.then(() => repository.listConnectionsFor(source.id)).then((connections) => {
        expect(connections[0]?.title).to.equal(null)
        expect(connections[0]?.target_id).to.equal(destination.id)
      })
    })
  })

  it('says why a connection with no content can’t be added', () => {
    cy.then(async () => ({
      source: await repository.create(createEntryInput({ content: textContent('Left my job') })),
      destination: await repository.create(
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

  it('keeps a half-written connection when the screen is left without discarding it', () => {
    cy.then(async () => ({
      source: await repository.create(createEntryInput({ content: textContent('Left my job') })),
      destination: await repository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      mountNewConnection(source.id).then(({ wrapper }) => {
        cy.findByLabelText('Connect to').select(destination.id)
        cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme, somehow')

        // Navigating away is not discarding. Only the Discard button throws work away.
        cy.then(async () => {
          const abandonDraft = cy.spy(useDraftsStore(), 'abandonDraft')
          wrapper.unmount()

          // `reset()` abandons the session fire-and-forget; this resolves once its flush lands.
          expect(abandonDraft).to.have.callCount(1)
          await abandonDraft.firstCall.returnValue
          const [saved] = await drafts.list()
          expect(saved).to.deep.include({
            kind: 'new_connection',
            parent_id: source.id,
            target_id: destination.id,
          })
        })
      })
    })
  })

  it('discards a half-written connection on request', () => {
    cy.then(async () => ({
      source: await repository.create(createEntryInput({ content: textContent('Left my job') })),
      destination: await repository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      mountNewConnection(source.id)
      cy.spy(drafts, 'save').as('saveDraft')

      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme, somehow')
      // A connection claims nothing, so only typing puts a row on disk for Discard to remove.
      cy.get('@saveDraft')
        .should('have.been.called')
        .then((saveDraft) => saveDraft.firstCall.returnValue)

      cy.then(() => {
        cy.spy(useDraftsStore(), 'discardDraft').as('discardDraft')
      })
      cy.findByRole('button', { name: 'Discard' }).click()

      // Resolves once the delete has landed.
      cy.get('@discardDraft')
        .should('have.been.calledOnce')
        .then((discardDraft) => discardDraft.firstCall.returnValue)
      cy.then(async () => {
        expect(await drafts.list()).to.have.length(0)
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
