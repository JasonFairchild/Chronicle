import type { Router } from 'vue-router'
import App from '@/App.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { selectTextRange } from '@/testing/selectTextRange'
import { createTestRouter } from '@/testing/testRouter'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { createEntryInput, type Entry } from '@/types/entry'

const PARENT_TEXT = 'I went to Lake Tahoe with Dad'
const PARENT_CONTENT = textContent(PARENT_TEXT)

function mountApp(id: string, router?: Router): Cypress.Chainable {
  return cy.mount(App, { routePath: `/entries/${id}`, router })
}

/** Creates one entry in the active repository; see `EntryDetailView.cy.ts`. */
function seed(input: Parameters<typeof createEntryInput>[0]): Promise<Entry> {
  return entryRepository.create(createEntryInput(input))
}

describe('EntryDetailView flows', () => {
  it('adds a related entry about the whole entry when nothing is marked, and lands on it', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      cy.findByRole('textbox', { name: 'Related entry' }).type('Still think about this trip')
      cy.findByRole('button', { name: 'Add entry' }).click()

      cy.findByRole('article').should('contain.text', 'Still think about this trip')
      cy.findByText('About').should('be.visible')
      cy.findByRole('link', { name: PARENT_TEXT }).should(
        'have.attr',
        'href',
        `/entries/${parent.id}`,
      )
      cy.then(() => entryRepository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.anchors).to.deep.equal([])
        // Nothing was marked, so the note claims nothing changed about the entry.
        expect(children[0]?.relation_type).to.equal('annotation')
      })
    })
  })

  it('keeps a related entry in progress when the reader moves to another entry', () => {
    cy.then(async () => {
      const parent = await seed({ content: PARENT_CONTENT })
      const other = await seed({ content: textContent('A different day entirely') })
      return { parent, other }
    }).then(({ parent, other }) => {
      const router = createTestRouter()
      mountApp(parent.id, router)
      cy.findByRole('button', { name: 'Create related entry' }).click()
      cy.findByRole('textbox', { name: 'Related entry' }).type('Half a thought about this')

      // The session has to close — saving after this would seal against the wrong entry — but
      // closing it is not the same as throwing it away.
      cy.then(() => {
        cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
      })
      // The same page for another entry, as a link or a typed address reaches it.
      cy.then(() => router.push(`/entries/${other.id}`))

      // Resolves once the session's flush has landed.
      cy.get('@abandonDraft')
        .should('have.been.calledOnce')
        .then((abandonDraft) => abandonDraft.firstCall.returnValue)
      cy.then(async () => {
        const [saved] = await draftRepository.list()
        expect(saved).to.deep.include({ kind: 'new_related', parent_id: parent.id })
        expect(docToPlainText(saved!.entry.content)).to.equal('Half a thought about this')
      })
    })
  })

  it('frees the entry when the page is left with a revision opened and untouched', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)
      cy.findByRole('button', { name: 'Revise entry' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).should('be.visible')

      // Leaving the page, not moving to another entry, is how most sessions end.
      cy.then(() => {
        cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
      })
      cy.findByRole('link', { name: 'Timeline' }).click()
      cy.get('@abandonDraft')
        .should('have.been.calledOnce')
        .then((abandonDraft) => abandonDraft.firstCall.returnValue)
      cy.findByRole('link', { name: PARENT_TEXT }).click()

      cy.findByRole('button', { name: 'Revise entry' }).should('be.visible')
      cy.findByRole('button', { name: 'Resume draft' }).should('not.exist')
    })
  })

  it('anchors a strike to the passage the user selects, in one atomic seal', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      cy.findByRole('textbox', { name: 'Entry being annotated' })
        .should('be.visible')
        .then(($editor) => selectTextRange($editor[0]!, 10, 20))

      cy.findByRole('button', { name: 'Strike' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

      cy.findByRole('textbox', { name: 'Related entry' }).type('Wrong lake')
      cy.findByRole('button', { name: 'Add entry' }).click()

      // Saving lands on the related entry; what it marked shows on the entry it's about.
      cy.findByRole('link', { name: PARENT_TEXT }).click()
      cy.findByText('Strikes “Lake Tahoe”, replaced with “Donner Lake”').should('be.visible')

      cy.then(() => entryRepository.listRevisions(parent.id)).then((revisions) => {
        expect(revisions).to.have.length(1)
        expect(revisions[0]?.revision_mode).to.equal('anchor')
      })
      cy.then(() => entryRepository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.anchors).to.have.length(1)
        expect(children[0]?.anchors[0]?.quote).to.equal('Lake Tahoe')
        // Striking reports a correction, so the note reads as an update without anyone being asked.
        expect(children[0]?.relation_type).to.equal('update')
      })
    })
  })

  it('pairs a highlight with inline wording, which is what a highlight-plus-comment reads as', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      cy.findByRole('textbox', { name: 'Entry being annotated' })
        .should('be.visible')
        .then(($editor) => selectTextRange($editor[0]!, 10, 20))

      cy.findByRole('button', { name: 'Highlight' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

      cy.findByRole('textbox', { name: 'Related entry' }).type('Actually')
      cy.findByRole('button', { name: 'Add entry' }).click()
      cy.findByRole('link', { name: PARENT_TEXT }).click()

      // A highlight is a mark on existing text, same as a strike — wording rides along with it the
      // same way, which is what `describeAnchor`'s `comment` case needed its own branch for.
      cy.findByText('On “Lake Tahoe”, adds “Donner Lake”').should('be.visible')

      cy.then(() => entryRepository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.relation_type).to.equal('update')
      })
    })
  })

  it('revises an entry by appending a version, leaving the original row untouched', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)

      cy.findByRole('button', { name: 'Revise entry' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end}, or so I remembered it.')
      cy.findByRole('button', { name: 'Save revision' }).click()

      cy.findByText(/Version 2 of 2/).should('be.visible')

      cy.then(() => entryRepository.listRevisions(parent.id)).then((revisions) => {
        expect(docToPlainText(revisions[0]!.content)).to.equal(
          `${PARENT_TEXT}, or so I remembered it.`,
        )
        expect(revisions[0]?.revision_mode).to.equal('direct')
        expect(revisions[0]?.authoring_trace?.events.length).to.be.greaterThan(0)
      })
      // The entry itself is never rewritten; the version chain is what carries the change.
      cy.then(() => entryRepository.getById(parent.id)).then((stored) => {
        expect(docToPlainText(stored!.content)).to.equal(PARENT_TEXT)
      })
    })
  })

  it('saves a revision that only changes formatting', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)

      cy.findByRole('button', { name: 'Revise entry' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{selectall}')
      cy.findByRole('button', { name: 'Bold' }).click()
      cy.findByRole('button', { name: 'Save revision' }).click()

      cy.findByText(/Version 2 of 2/).should('be.visible')
      cy.then(() => entryRepository.listRevisions(parent.id)).then(([revision]) => {
        expect(docToPlainText(revision!.content)).to.equal(PARENT_TEXT)
        expect(revision!.content).to.contain('"bold"')
      })
    })
  })

  it('discards a revision on request, leaving the entry untouched', () => {
    cy.then(() => seed({ content: PARENT_CONTENT })).then((parent) => {
      mountApp(parent.id)

      cy.findByRole('button', { name: 'Revise entry' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end} — actually never mind')
      // Revise wrote a claim, and Discard waits on that write before deleting: there is always a
      // row to remove.
      cy.then(() => {
        cy.spy(useDraftsStore(), 'discardDraft').as('discardDraft')
      })
      cy.findByRole('button', { name: 'Discard' }).click()

      cy.findByText(PARENT_TEXT).should('be.visible')
      // Resolves once the delete has landed.
      cy.get('@discardDraft')
        .should('have.been.calledOnce')
        .then((discardDraft) => discardDraft.firstCall.returnValue)
      cy.then(async () => {
        expect(await draftRepository.list()).to.have.length(0)
        expect(await entryRepository.listRevisions(parent.id)).to.have.length(0)
      })
    })
  })
})
