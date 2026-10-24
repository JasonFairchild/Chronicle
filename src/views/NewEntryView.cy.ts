import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { textContent } from '@/testing/documents'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'
import { createTestRouter } from '@/testing/testRouter'
import { emptyEntryDates } from '@/types/entry'
import NewEntryView from '@/views/NewEntryView.vue'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('NewEntryView', () => {
  it('leaves for the saved entry on Save', () => {
    const router = createTestRouter()
    cy.mount(NewEntryView, { routePath: '/entries/new', router })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.wrap(router).its('currentRoute.value.name').should('equal', 'entry-detail')
  })

  it('names its draft in the URL, and a new one once Discard empties the page', () => {
    const router = createTestRouter()
    cy.mount(NewEntryView, { routePath: '/entries/new', router })

    cy.wrap(router)
      .its('currentRoute.value.query.draft')
      .should('be.a', 'string')
      .then((first) => {
        cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
        cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
        cy.findByRole('button', { name: 'Discard' }).click()

        cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
        cy.findByText('We drove up on Friday.').should('not.exist')
        cy.wrap(router)
          .its('currentRoute.value.query.draft')
          .should('be.a', 'string')
          .and('not.equal', first)
      })
  })

  it('keeps what was written, and says why, when the discard fails', () => {
    cy.stub(draftRepository, 'delete').rejects(new Error('discard rejected'))
    cy.mount(NewEntryView, { routePath: '/entries/new' })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByRole('alert').should('have.text', 'discard rejected')
    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'We drove up on Friday.')
  })

  it('starts afresh, under a new name, when the draft it links to is gone', () => {
    const router = createTestRouter()
    cy.mount(NewEntryView, { routePath: '/entries/new?draft=session-gone', router })

    cy.findByRole('textbox', { name: 'New entry' }).should('be.visible')
    cy.wrap(router)
      .its('currentRoute.value.query.draft')
      .should('be.a', 'string')
      .and('not.equal', 'session-gone')
  })

  it('says why the draft it links to could not be read, and starts afresh', () => {
    const router = createTestRouter()
    cy.stub(draftRepository, 'getById').rejects(new Error('read rejected'))
    cy.mount(NewEntryView, { routePath: '/entries/new?draft=session-1', router })

    cy.findByRole('alert').should('have.text', 'read rejected')
    cy.findByRole('textbox', { name: 'New entry' }).should('be.visible')
    cy.wrap(router)
      .its('currentRoute.value.query.draft')
      .should('be.a', 'string')
      .and('not.equal', 'session-1')
  })

  it('reopens the draft it links to, with its words, title and dates', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: {
            content: textContent('Half a thought'),
            title: 'Lake Tahoe',
            dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
            events: TYPED,
          },
        }),
      ),
    )
    cy.mount(NewEntryView, { routePath: '/entries/new?draft=session-1' })

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'Half a thought')
    cy.findByLabelText('Happened').should('have.value', '1994-06-11')
  })

  it('shows a linked draft that will not reopen, and starts afresh once it is discarded', () => {
    cy.then(() =>
      seedDraft(draftRepository, {
        ...makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
        started_at: 'not a timestamp',
      }),
    )
    cy.mount(NewEntryView, { routePath: '/entries/new?draft=session-1' })

    cy.findByRole('alert').should(
      'have.text',
      'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
    )
    cy.findByText('Half a thought').should('be.visible')

    cy.findByRole('button', { name: 'Discard' }).click()

    // Shown read-only, it had no textbox; one appearing is the fresh draft.
    cy.findByRole('textbox', { name: 'New entry' }).should('be.visible')
    cy.findByText('Half a thought').should('not.exist')
  })

  it('offers a new entry once its draft is saved or discarded elsewhere', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
      ),
    )
    cy.mount(NewEntryView, { routePath: '/entries/new?draft=session-1' })

    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'Half a thought')

    // Another tab's save or discard leaves no row; returning here catches up, as App does on focus.
    cy.then(async () => {
      await draftRepository.delete('session-1')
      await useDraftsStore().adoptChangesElsewhere()
    })

    cy.findByText('This draft was saved or discarded elsewhere.').should('be.visible')
    cy.findByRole('button', { name: 'Start a new entry' }).click()

    cy.findByRole('textbox', { name: 'New entry' }).should('be.visible')
    cy.findByText('Half a thought').should('not.exist')
    cy.findByText('This draft was saved or discarded elsewhere.').should('not.exist')
  })

  it('lets go of the draft it holds when it is left', () => {
    const router = createTestRouter()
    cy.mount(NewEntryView, { routePath: '/entries/new', router }).then(({ wrapper }) => {
      cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')

      cy.wrap(router)
        .its('currentRoute.value.query.draft')
        .should('be.a', 'string')
        .then((id) => {
          wrapper.unmount()

          cy.get('@abandonDraft').should('have.been.calledOnce').and('have.been.calledWith', id)
        })
    })
  })
})
