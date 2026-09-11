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

    cy.findByRole('heading').click().type('Lake Tahoe{enter}We drove up on Friday.')

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

  it('starts a fresh empty session after a save rather than reopening the last one', () => {
    mountForm()

    cy.findByRole('textbox', { name: 'New entry' }).type('First entry')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('button', { name: 'Save entry' }).should('be.disabled')
    cy.findByText('First entry').should('not.exist')
  })

  it('leaves no draft behind for a composer that was only opened', () => {
    // What the timeline finishing its load looks like from here. An editor becoming editable is
    // not an edit, and treating it as one used to start a writing session nobody began — one
    // empty draft per visit to the page.
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
})
