import App from '@/App.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { createEntryInput } from '@/types/entry'

describe('NewConnectionView flows', () => {
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
      cy.mount(App, { routePath: `/entries/${source.id}/connect` })

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

  it('keeps a half-written connection when the screen is left without discarding it', () => {
    cy.then(async () => ({
      source: await entryRepository.create(
        createEntryInput({ content: textContent('Left my job') }),
      ),
      destination: await entryRepository.create(
        createEntryInput({ content: textContent('Started the degree') }),
      ),
    })).then(({ source, destination }) => {
      cy.mount(App, { routePath: `/entries/${source.id}/connect` })
      cy.findByLabelText('Connect to').select(destination.id)
      cy.findByRole('textbox', { name: 'New connection' }).type('These rhyme, somehow')

      // Navigating away is not discarding. Only the Discard button throws work away.
      cy.then(() => {
        cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
      })
      cy.findByRole('link', { name: 'Timeline' }).click()

      // `reset()` abandons the session fire-and-forget; this resolves once its flush lands.
      cy.get('@abandonDraft')
        .should('have.been.calledOnce')
        .then((abandonDraft) => abandonDraft.firstCall.returnValue)
      cy.then(async () => {
        const [saved] = await draftRepository.list()
        expect(saved).to.deep.include({
          kind: 'new_connection',
          parent_id: source.id,
          target_id: destination.id,
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
      cy.mount(App, { routePath: `/entries/${source.id}/connect` })
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
})
