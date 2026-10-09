import App from '@/App.vue'
import NewConnectionView from '@/views/NewConnectionView.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { createEntryInput } from '@/types/entry'

function mountNewConnection(id: string): Cypress.Chainable {
  return cy.mount(NewConnectionView, { props: { id }, routePath: `/entries/${id}/connect` })
}

describe('NewConnectionView', () => {
  it('creates a connection with a title, dates, and rich content, then lands on its own page', () => {
    cy.then(async () => ({
      source: await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      ),
      destination: await entryRepository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      cy.mount(App, { routePath: `/entries/${source.id}/connect` })

      cy.findByText(/New connection from/).should('be.visible')

      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByLabelText('Happened').type('2020-01-01')
      cy.findByRole('textbox', { name: 'Title' }).type('Led to it')
      cy.findByRole('textbox', { name: 'New connection' }).type('The layoff made room for it.')
      cy.findByRole('button', { name: 'Add connection' }).click()

      cy.findByRole('heading', { name: 'Led to it' }).should('be.visible')
      cy.findByRole('article').should('contain.text', 'The layoff made room for it.')
      cy.findByText(/Happened .*2020/).should('be.visible')
      cy.findByText('Connects').should('be.visible')
      cy.findByRole('link', { name: 'Left my job' }).should(
        'have.attr',
        'href',
        `/entries/${source.id}`,
      )
      cy.findByRole('link', { name: 'Started the degree' }).should(
        'have.attr',
        'href',
        `/entries/${destination.id}`,
      )
    })
  })

  it('adds an untitled connection', () => {
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

      // A connection can be as light as noticing two things share something. Making it name that
      // recognition before it can be recorded would stop most of them from being made at all.
      cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme.')
      cy.findByRole('button', { name: 'Add connection' }).click()

      // The composer closes only once the save has landed.
      cy.findByRole('textbox', { name: 'New connection' }).should('not.exist')
      cy.then(() => entryRepository.listConnectionsFor(source.id)).then((connections) => {
        expect(connections[0]?.title).to.equal(null)
        expect(connections[0]?.target_id).to.equal(destination.id)
      })
    })
  })

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

  it('keeps a half-written connection when the screen is left without discarding it', () => {
    cy.then(async () => ({
      source: await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      ),
      destination: await entryRepository.create(
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
          const [saved] = await draftRepository.list()
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
      source: await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      ),
      destination: await entryRepository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      mountNewConnection(source.id)
      cy.spy(draftRepository, 'save').as('saveDraft')

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
        expect(await draftRepository.list()).to.have.length(0)
      })
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
})
