import { createPinia, setActivePinia } from 'pinia'

import EntryComposer from '@/components/EntryComposer.vue'
import { useDraftSession } from '@/composables/useDraftSession'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft } from '@/testing/draftFixtures'
import { emptyEntryDates } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** A new entry's session, begun the way a view begins one before mounting the composer. */
function beginSession() {
  setActivePinia(createPinia())
  const session = useDraftSession()
  session.begin({ kind: 'new_root' })
  return session
}

describe('EntryComposer', () => {
  it('shows all of a draft that will not reopen to copy from, with nothing to change and only Discard', () => {
    const text =
      'Everything I meant to say about the lake that summer: the cabin, the dock, the long drive ' +
      'home, and why none of it went the way we planned.'
    cy.then(async () => {
      await draftRepository.save({
        ...makeDraft('session-1', {
          entry: {
            content: textContent(text),
            title: 'Lake Tahoe',
            dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
            events: TYPED,
          },
        }),
        started_at: 'not a timestamp',
      })
      setActivePinia(createPinia())
      const session = useDraftSession()
      await session.resume('session-1')
      return session
    }).then((session) => {
      cy.mount(EntryComposer, {
        props: { session, label: 'New entry', saveLabel: 'Save entry' },
        attrs: { onSave: cy.spy(), onDiscard: cy.spy().as('onDiscard') },
      })

      cy.findByRole('alert').should(
        'have.text',
        'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
      )
      cy.findByText('Lake Tahoe').should('be.visible')
      cy.findByRole('textbox', { name: 'Title' }).should('not.exist')
      cy.findByText(text).should('be.visible')
      cy.findByLabelText('Happened').should('have.value', '1994-06-11').and('have.attr', 'readonly')
      cy.findByRole('textbox', { name: 'New entry' }).should('not.exist')
      cy.findByRole('button', { name: 'Save entry' }).should('not.exist')

      cy.findByRole('button', { name: 'Discard' }).click()
      cy.get('@onDiscard').should('have.been.calledOnce')
    })
  })

  it('passes the title on as typed, spaces and all', () => {
    const session = beginSession()
    cy.spy(session, 'handleFieldsChange').as('handleFieldsChange')
    cy.mount(EntryComposer, {
      props: { session, label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy(), onDiscard: cy.spy() },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe ')

    cy.get('@handleFieldsChange')
      .its('lastCall.args.0')
      .should('deep.equal', { title: 'Lake Tahoe ' })
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe ')
  })

  it('keeps the title in place, disabled, while a save is in flight', () => {
    cy.stub(draftRepository, 'seal').returns(new Promise<never>(() => {}))
    const session = beginSession()
    cy.mount(EntryComposer, {
      props: { session, label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: () => session.save(), onDiscard: cy.spy() },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()

    cy.findByRole('textbox', { name: 'Title' })
      .should('be.disabled')
      .and('have.value', 'Lake Tahoe')
  })

  it('moves from the title into the body on Enter', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy(), onDiscard: cy.spy(), onChange: cy.spy().as('change') },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')

    cy.get('@change')
      .its('lastCall.args.0.content')
      .then((content) => expect(docToPlainText(content)).to.equal('We drove up on Friday.'))
  })

  it('moves from the title into the body on Tab, skipping the toolbar between them', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy(), onDiscard: cy.spy(), onChange: cy.spy().as('change') },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.focused().type('We drove up on Friday.')

    cy.get('@change')
      .its('lastCall.args.0.content')
      .then((content) => expect(docToPlainText(content)).to.equal('We drove up on Friday.'))
  })

  it('says why an entry with nothing written can’t be saved, even with a title', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy().as('onSave'), onDiscard: cy.spy() },
    })

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should(
      'have.text',
      'Write something in the entry first. A title alone can’t be saved.',
    )

    // Any change answers it, even one that still leaves nothing written: a title names an entry
    // without being one, and spaces say nothing.
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('   ')
    cy.findByRole('alert').should('not.exist')

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('be.visible')
    cy.get('@onSave').should('not.have.been.called')

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.get('@onSave').should('have.been.calledOnce')
  })

  it('clears why it couldn’t save once the title changes', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy(), onDiscard: cy.spy() },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('be.visible')

    cy.findByRole('textbox', { name: 'Title' }).type(', 1994')
    cy.findByRole('alert').should('not.exist')
  })

  it('clears why it couldn’t save once a detail changes', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy(), onDiscard: cy.spy() },
    })

    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('be.visible')

    cy.findByLabelText('Where').type('Lake Tahoe')
    cy.findByRole('alert').should('not.exist')
  })

  it('says why a save or a discard failed, until the next change', () => {
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: {
        onSave: cy.stub().rejects(new Error('seal rejected')),
        onDiscard: cy.stub().rejects(new Error('discard rejected')),
      },
    })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('button', { name: 'Save entry' }).click()
    cy.findByRole('alert').should('have.text', 'seal rejected')

    cy.findByRole('textbox', { name: 'New entry' }).type(' Saturday, actually.')
    cy.findByRole('alert').should('not.exist')

    cy.findByRole('button', { name: 'Discard' }).click()
    cy.findByRole('alert').should('have.text', 'discard rejected')
  })

  it('says the draft isn’t being saved, until trying again saves it', () => {
    const save = cy.stub(draftRepository, 'save').rejects(new Error('Quota'))
    cy.mount(EntryComposer, {
      props: { session: beginSession(), label: 'New entry', saveLabel: 'Save entry' },
      attrs: { onSave: cy.spy(), onDiscard: cy.spy() },
    })

    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')
    cy.findByRole('alert').should('contain.text', 'This draft isn’t being saved right now.')

    cy.then(() => save.restore())
    cy.findByRole('button', { name: 'Try again' }).click()
    cy.findByRole('alert').should('not.exist')
  })
})
