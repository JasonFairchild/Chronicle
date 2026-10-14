import { createPinia, setActivePinia } from 'pinia'
import NewEntryView from '@/views/NewEntryView.vue'
import { draftRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { textContent } from '@/testing/documents'
import { makeDraft, seedDraft } from '@/testing/draftFixtures'
import { createTestRouter } from '@/testing/testRouter'
import { emptyEntryDates } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('NewEntryView', () => {
  it('lands on the entry it saves', () => {
    const router = createTestRouter()
    cy.mount(NewEntryView, { routePath: '/entries/new', router })
    cy.then(() => {
      cy.spy(useDraftsStore(), 'sealDraft').as('sealDraft')
    })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.get('@sealDraft')
      .should('have.been.calledOnce')
      .then((sealDraft) => sealDraft.firstCall.returnValue)
      .then((saved) => {
        cy.wrap(router)
          .its('currentRoute.value')
          .should('deep.include', { name: 'entry-detail', params: { id: saved.id } })
      })
  })

  it('keeps what was written, and says why, when the save fails', () => {
    const router = createTestRouter()
    cy.stub(draftRepository, 'seal').rejects(new Error('seal rejected'))
    cy.mount(NewEntryView, { routePath: '/entries/new', router })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('alert').should('have.text', 'seal rejected')
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'We drove up on Friday.')
    cy.wrap(router).its('currentRoute.value.name').should('equal', 'new-entry')
    cy.findByRole('button', { name: 'Save entry' }).should('be.enabled')
  })

  it('empties the page on Discard, ready for the next entry', () => {
    cy.mount(NewEntryView, { routePath: '/entries/new' })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.findByText('We drove up on Friday.').should('not.exist')
  })

  it('reopens the draft it was linked to, with its words, title and dates', () => {
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

  it('offers a new entry once its draft is saved in another tab', () => {
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

    // Another tab saves the draft; returning here catches up with disk, as App does on focus.
    cy.then(async () => {
      const thisTab = useDraftsStore()
      setActivePinia(createPinia())
      const otherTab = useDraftsStore()
      await otherTab.resumeDraft('session-1')
      await otherTab.sealDraft('session-1')
      await thisTab.adoptChangesElsewhere()
    })

    cy.findByText('This draft was saved or discarded elsewhere.').should('be.visible')
    cy.findByRole('button', { name: 'Start a new entry' }).click()

    cy.findByRole('textbox', { name: 'New entry' }).should('be.visible')
    cy.findByText('Half a thought').should('not.exist')
    cy.findByText('This draft was saved or discarded elsewhere.').should('not.exist')
  })

  it('keeps the version another tab saved first, and shows what this one had to copy', () => {
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

    // Another tab, with its own stores over the same database, writes the draft first.
    cy.then(async () => {
      setActivePinia(createPinia())
      const otherTab = useDraftsStore()
      await otherTab.resumeDraft('session-1')
      otherTab.recordChange('session-1', {
        content: textContent('Half a thought, finished elsewhere'),
        steps: [{ stepType: 'replace' }],
      })
      await otherTab.flush('session-1')
    })

    // This tab hasn't caught up, so its next write lands on a draft that has moved on.
    cy.findByRole('textbox', { name: 'New entry' }).type('{ctrl+end} here')

    cy.findByText(
      'This draft was changed elsewhere at the same time, and now shows what was saved there. ' +
        'What you had here is below.',
    ).should('be.visible')
    cy.findByText('Half a thought here').should('be.visible')
    cy.findByRole('textbox', { name: 'New entry' }).should(
      'contain.text',
      'Half a thought, finished elsewhere',
    )
  })
})
