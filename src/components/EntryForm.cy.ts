import EntryForm from '@/components/EntryForm.vue'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import type { EntryRepository } from '@/repositories/entryRepository'
import { useDraftsStore } from '@/stores/draftsStore'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'

describe('EntryForm', () => {
  let entries: EntryRepository

  beforeEach(() => {
    entries = freshEntryRepository()
    freshDraftRepository()
  })

  it('holds a session as a draft and commits one entry only when it is saved', () => {
    cy.mount(EntryForm)
    cy.spy(draftRepository, 'save').as('saveDraft')

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')

    // Still a draft: nothing a person has not finished belongs in the timeline.
    cy.get('@saveDraft')
      .should('have.been.called')
      .then((saveDraft) => saveDraft.firstCall.returnValue)
    cy.then(async () => {
      expect(await entries.listRootEntries()).to.have.length(0)
    })

    cy.findByRole('button', { name: 'Save entry' }).click()

    // The composer empties only once the save has landed.
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.then(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.title).to.equal('Lake Tahoe')
      expect(docToPlainText(saved!.content)).to.equal('We drove up on Friday.')
      expect(saved?.authoring_trace?.events.length).to.be.greaterThan(0)
      // The buffer is working space, so sealing discards it rather than leaving a duplicate.
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('saves when something happened and when it was first written down, with the entry', () => {
    cy.mount(EntryForm)

    cy.findByLabelText('Happened').type('1994-06-11')
    cy.findByLabelText('Time it happened').type('late morning')
    cy.findByLabelText('Originally written').type('1994-06-12')
    cy.findByRole('textbox', { name: 'Title' }).type('The green notebook')
    cy.findByRole('textbox', { name: 'New entry' }).type('From the green notebook')
    cy.findByRole('button', { name: 'Save entry' }).click()

    // The composer empties only once the save has landed.
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.then(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.dates.occurred_at).to.equal('1994-06-11')
      expect(saved?.dates.occurred_time_note).to.equal('late morning')
      expect(saved?.dates.recorded_at).to.equal('1994-06-12')
      // Not asked for, so not invented.
      expect(saved?.dates.recorded_time_note).to.equal(null)
    })
  })

  it('starts a fresh empty session after a save rather than reopening the last one', () => {
    cy.mount(EntryForm)

    cy.findByRole('textbox', { name: 'Title' }).type('The first one')
    cy.findByRole('textbox', { name: 'New entry' }).type('First entry')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.findByText('First entry').should('not.exist')
  })

  it('throws a draft away on Discard and starts over empty', () => {
    cy.mount(EntryForm)
    cy.spy(draftRepository, 'save').as('saveDraft')

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')
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

  it('leaves no draft behind for a composer that was only opened', () => {
    cy.mount(EntryForm).then(async ({ wrapper }) => {
      const abandonDraft = cy.spy(useDraftsStore(), 'abandonDraft')
      wrapper.unmount()

      // Resolves once the session's flush has landed, so an empty draft would be on disk by now.
      expect(abandonDraft).to.have.callCount(1)
      await abandonDraft.firstCall.returnValue
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('keeps what was typed when the composer is left without saving', () => {
    cy.mount(EntryForm).then(({ wrapper }) => {
      cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
      cy.focused().type('We drove up on Friday.')

      // Leaving is not discarding: the session is let go, and what it held stays a draft.
      cy.then(async () => {
        const abandonDraft = cy.spy(useDraftsStore(), 'abandonDraft')
        wrapper.unmount()

        expect(abandonDraft).to.have.callCount(1)
        await abandonDraft.firstCall.returnValue
        const [draft] = await draftRepository.list()
        expect(draft?.entry.title).to.equal('Lake Tahoe')
        expect(docToPlainText(draft!.entry.content)).to.equal('We drove up on Friday.')
      })
    })
  })

  it('drops a draft whose words are all deleted', () => {
    cy.mount(EntryForm).then(({ wrapper }) => {
      cy.spy(draftRepository, 'save').as('saveDraft')
      cy.findByRole('textbox', { name: 'New entry' }).type('Lake Tahoe')
      // On disk with its words first, so there is a row for deleting them to remove.
      cy.get('@saveDraft')
        .should('have.been.called')
        .then((saveDraft) => saveDraft.firstCall.returnValue)

      cy.findByRole('textbox', { name: 'New entry' }).type('{selectall}{backspace}')
      cy.then(async () => {
        const abandonDraft = cy.spy(useDraftsStore(), 'abandonDraft')
        wrapper.unmount()

        // Resolves once the session's flush has landed.
        await abandonDraft.firstCall.returnValue
        expect(await draftRepository.list()).to.have.length(0)
      })
    })
  })

  it('says why an entry with nothing written can’t be saved, even with a title', () => {
    cy.mount(EntryForm)
    cy.then(() => {
      cy.spy(useDraftsStore(), 'sealDraft').as('sealDraft')
    })

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should(
      'have.text',
      'Write something in the entry first. A title alone can’t be saved.',
    )

    // Any change answers it, even one that still leaves nothing written: a title names an entry
    // without being one, and spaces say nothing.
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('   ')
    cy.findByRole('alert').should('not.exist')

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('be.visible')
    cy.get('@sealDraft').should('not.have.been.called')
  })

  it('saves an entry that was never given a title', () => {
    cy.mount(EntryForm)

    // The title field is offered and skipped. A daily journal is mostly entries nobody would name,
    // and a required title there produces filler rather than better names.
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    cy.findByRole('button', { name: 'Save entry' }).click()

    // The composer empties only once the save has landed.
    cy.findByRole('textbox', { name: 'New entry' }).should('not.contain.text', 'We drove up')
    cy.then(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.title).to.equal(null)
      expect(docToPlainText(saved!.content)).to.equal('We drove up on Friday.')
    })
  })
})
