import EntryForm from '@/components/EntryForm.vue'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'

describe('EntryForm', () => {
  let entries: DexieEntryRepository

  beforeEach(() => {
    entries = freshEntryRepository()
    freshDraftRepository()
  })

  function mountForm() {
    cy.mount(EntryForm)
  }

  it('holds a session as a draft and commits one entry only when it is saved', () => {
    mountForm()

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')

    // Still a draft: nothing a person has not finished belongs in the timeline.
    cy.then(async () => {
      expect(await entries.listRootEntries()).to.have.length(0)
    })

    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.then(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.title).to.equal('Lake Tahoe')
      expect(docToPlainText(saved!.content)).to.equal('We drove up on Friday.')
      expect(saved?.authoring_trace?.steps.length).to.be.greaterThan(0)
      // The buffer is working space, so sealing discards it rather than leaving a duplicate.
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('saves when something happened and when it was first written down, with the entry', () => {
    mountForm()

    cy.findByLabelText('Happened').type('1994-06-11')
    cy.findByLabelText('Time it happened').type('late morning')
    cy.findByLabelText('Originally written').type('1994-06-12')
    cy.findByRole('textbox', { name: 'Title' }).type('The green notebook')
    cy.findByRole('textbox', { name: 'New entry' }).type('From the green notebook')
    cy.findByRole('button', { name: 'Save entry' }).click()

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
    mountForm()

    cy.findByRole('textbox', { name: 'Title' }).type('The first one')
    cy.findByRole('textbox', { name: 'New entry' }).type('First entry')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('button', { name: 'Save entry' }).should('be.disabled')
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', '')
    cy.findByText('First entry').should('not.exist')
  })

  it('leaves no draft behind for a composer that was only opened', () => {
    // What the timeline finishing its load looks like from here. An editor becoming editable is
    // not an edit: treating it as one would start a writing session nobody began, leaving an empty
    // draft behind per visit to the page.
    cy.mount(EntryForm, { props: { disabled: true } }).then(({ wrapper }) =>
      wrapper.setProps({ disabled: false }),
    )

    cy.then(async () => {
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('will not save an empty document', () => {
    mountForm()

    cy.findByRole('button', { name: 'Save entry' }).should('be.disabled')

    cy.findByRole('textbox', { name: 'New entry' }).type('   ')

    cy.findByRole('button', { name: 'Save entry' }).should('be.disabled')
  })

  it('saves an entry that was never given a title', () => {
    mountForm()

    // The title field is offered and skipped. A daily journal is mostly entries nobody would name,
    // and a required title there produces filler rather than better names.
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    cy.findByRole('button', { name: 'Save entry' }).should('be.enabled').click()

    cy.then(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.title).to.equal(null)
      expect(docToPlainText(saved!.content)).to.equal('We drove up on Friday.')
    })
  })
})
