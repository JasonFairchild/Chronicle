import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { textContent } from '@/testing/documents'
import { draftChangeTo, makeDraft, seedDraft } from '@/testing/draftFixtures'
import { createTestRouter } from '@/testing/testRouter'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('NewEntryView flows', () => {
  it('holds what is written as a draft until it is saved, then lands on the entry, details and all', () => {
    cy.mount(App, { routePath: '/entries/new' })
    cy.spy(draftRepository, 'save').as('saveDraft')

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByLabelText('Happened').type('1994-06-11')
    cy.findByLabelText('Time it happened').type('late morning')
    cy.findByLabelText('Where').type('home')
    cy.findByLabelText('Originally written').type('1994-06-12')
    cy.findByLabelText('Written in').type('paper journal')
    cy.findByLabelText('More about what it was written in').type('blue Moleskine')

    // Still a draft: nothing a person has not finished belongs in the timeline.
    cy.get('@saveDraft')
      .should('have.been.called')
      .then((saveDraft) => saveDraft.firstCall.returnValue)
    cy.then(async () => {
      expect(await entryRepository.listRootEntries()).to.have.length(0)
    })

    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('heading', { name: 'Lake Tahoe' }).should('be.visible')
    cy.findByRole('article').should('contain.text', 'We drove up on Friday.')
    cy.findByText(/Happened .*1994 · late morning/).should('be.visible')
    cy.findByText('Where: home').should('be.visible')
    // Not asked for, so not invented.
    cy.findByText(/^Originally written .*1994$/).should('be.visible')
    cy.findByText('Written in paper journal · blue Moleskine').should('be.visible')
    cy.then(async () => {
      const [saved] = await entryRepository.listRootEntries()
      expect(saved?.authoring_trace?.events.length).to.be.greaterThan(0)
      // The buffer is working space, so sealing discards it rather than leaving a duplicate.
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('saves an entry that was never given a title', () => {
    cy.mount(App, { routePath: '/entries/new' })

    // The title field is offered and skipped. A daily journal is mostly entries nobody would name,
    // and a required title there produces filler rather than better names.
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('article').should('contain.text', 'We drove up on Friday.')
    cy.then(async () => {
      const [saved] = await entryRepository.listRootEntries()
      expect(saved?.title).to.equal(null)
    })
  })

  it('throws a draft away on Discard and starts over empty', () => {
    cy.mount(App, { routePath: '/entries/new' })
    cy.spy(draftRepository, 'save').as('saveDraft')

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    // On disk first, so there is a row for Discard to remove.
    cy.get('@saveDraft')
      .should('have.been.called')
      .then((saveDraft) => saveDraft.firstCall.returnValue)
    cy.then(() => {
      cy.spy(useDraftsStore(), 'discardDraft').as('discardDraft')
    })
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.findByText('We drove up on Friday.').should('not.exist')
    // Resolves once the delete has landed.
    cy.get('@discardDraft')
      .should('have.been.calledOnce')
      .then((discardDraft) => discardDraft.firstCall.returnValue)
    cy.then(async () => {
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('reopens what was typed after a reload', () => {
    const router = createTestRouter()
    cy.mount(App, { routePath: '/entries/new', router })
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    // A reload: written out as App does for a tab being left, then the same address afresh.
    cy.then(() => useDraftsStore().flushAll())
    cy.wrap(router)
      .its('currentRoute.value.fullPath')
      .then((path) => cy.mount(App, { routePath: path }))

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'We drove up on Friday.')
  })

  it('leaves no draft behind for a page that was only opened', () => {
    cy.mount(App, { routePath: '/entries/new' })

    cy.then(() => {
      cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
    })
    cy.findByRole('link', { name: 'Timeline' }).click()

    // Resolves once the session's flush has landed, so an empty draft would be on disk by now.
    cy.get('@abandonDraft')
      .should('have.been.calledOnce')
      .then((abandonDraft) => abandonDraft.firstCall.returnValue)
    cy.then(async () => {
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('keeps what was typed, details and all, when the page is left without saving', () => {
    cy.mount(App, { routePath: '/entries/new' })
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByLabelText('Happened').type('1994-06-11')
    cy.findByLabelText('Time it happened').type('late morning')
    cy.findByLabelText('Where').type('home')
    cy.findByLabelText('Originally written').type('1994-06-12')
    cy.findByLabelText('Time it was originally written').type('evening')
    cy.findByLabelText('Written in').type('paper journal')
    cy.findByLabelText('More about what it was written in').type('blue Moleskine')

    // Leaving is not discarding: the session is let go, and what it held stays a draft.
    cy.then(() => {
      cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
    })
    cy.findByRole('link', { name: 'Timeline' }).click()

    cy.get('@abandonDraft')
      .should('have.been.calledOnce')
      .then((abandonDraft) => abandonDraft.firstCall.returnValue)
    cy.then(async () => {
      const [draft] = await draftRepository.list()
      expect(draft?.entry.title).to.equal('Lake Tahoe')
      expect(docToPlainText(draft!.entry.content)).to.equal('We drove up on Friday.')
      expect(draft?.entry.dates).to.deep.equal({
        occurred_at: '1994-06-11',
        occurred_time_note: 'late morning',
        recorded_at: '1994-06-12',
        recorded_time_note: 'evening',
      })
      expect(draft?.entry.location).to.equal('home')
      expect(draft?.entry.original_medium).to.equal('paper journal')
      expect(draft?.entry.original_medium_note).to.equal('blue Moleskine')
    })
  })

  it('drops a draft whose words are all deleted', () => {
    cy.mount(App, { routePath: '/entries/new' })
    cy.spy(draftRepository, 'save').as('saveDraft')
    cy.findByRole('textbox', { name: 'New entry' }).type('Lake Tahoe')
    // On disk with its words first, so there is a row for deleting them to remove.
    cy.get('@saveDraft')
      .should('have.been.called')
      .then((saveDraft) => saveDraft.firstCall.returnValue)

    cy.findByRole('textbox', { name: 'New entry' }).type('{selectall}{backspace}')
    cy.then(() => {
      cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
    })
    cy.findByRole('link', { name: 'Timeline' }).click()

    // Resolves once the session's flush has landed.
    cy.get('@abandonDraft')
      .should('have.been.calledOnce')
      .then((abandonDraft) => abandonDraft.firstCall.returnValue)
    cy.then(async () => {
      expect(await draftRepository.list()).to.have.length(0)
    })
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
    cy.mount(App, { routePath: '/entries/new?draft=session-1' })

    cy.findByRole('textbox', { name: 'New entry' }).should('contain.text', 'Half a thought')

    // Another tab, with its own stores over the same database, writes the draft first.
    cy.then(async () => {
      setActivePinia(createPinia())
      const otherTab = useDraftsStore()
      await otherTab.resumeDraft('session-1')
      otherTab.recordChange('session-1', draftChangeTo('Half a thought, finished elsewhere'))
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
    cy.then(async () => {
      const stored = await draftRepository.getById('session-1')
      expect(docToPlainText(stored!.entry.content)).to.equal('Half a thought, finished elsewhere')
    })
  })
})
