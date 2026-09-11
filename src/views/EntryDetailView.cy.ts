import EntryDetailView from '@/views/EntryDetailView.vue'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import type { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'
import {
  freshDraftRepository,
  freshEntryRepository,
  freshMediaRepository,
} from '@/testing/realRepositories'
import { docToPlainText } from '@/domain/entryDocument'
import { createDocLocation } from '@/domain/resolveAnchor'
import { createEntryInput, type Entry } from '@/types/entry'

const PARENT_TEXT = 'I went to Lake Tahoe with Dad'

function mountDetail(id: string): void {
  cy.mount(EntryDetailView, { props: { id }, routePath: '/' })
}

// A fresh, isolated real repository per test, pointed at by the composition root, so the mounted
// component's own useEntriesStore() call reaches the same instance this file seeds into.
let repository: DexieEntryRepository
let media: OpfsMediaRepository

/** Seeds the active repository and yields the created entry to the chain. */
function seed(input: Parameters<typeof createEntryInput>[0]): Cypress.Chainable<Entry> {
  return cy.then(() => repository.create(createEntryInput(input)))
}

describe('EntryDetailView', () => {
  beforeEach(() => {
    repository = freshEntryRepository()
    media = freshMediaRepository()
    freshDraftRepository()
  })

  it('renders the entry’s own text', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByText(PARENT_TEXT).should('be.visible')
    })
  })

  it('shows a child entry separately rather than spliced into the parent', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      seed({
        content: 'It was actually Donner Lake',
        parent_id: parent.id,
        relation_type: 'update',
      }).then(() => {
        mountDetail(parent.id)

        cy.findByText('It was actually Donner Lake').should('be.visible')
        cy.findByText(PARENT_TEXT).should('be.visible')
      })
    })
  })

  it('describes which passage an anchored child is about', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      seed({
        content: 'Wrong lake',
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ kind: 'strike', at: createDocLocation(PARENT_TEXT, 10, 20, null) }],
      }).then(() => {
        mountDetail(parent.id)

        cy.findByText('Strikes “Lake Tahoe”').should('be.visible')
      })
    })
  })

  it('keeps the original wording visible when a revision orphans an anchor', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      seed({
        content: 'Wrong lake',
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ kind: 'strike', at: createDocLocation(PARENT_TEXT, 10, 20, null) }],
      }).then(() => {
        seed({
          content: 'I stayed home that summer',
          parent_id: parent.id,
          relation_type: 'revision',
        }).then(() => {
          mountDetail(parent.id)

          cy.findByText('Was attached to: “Lake Tahoe”').should('be.visible')
        })
      })
    })
  })

  it('reports the version position once an entry has been revised', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      seed({
        content: 'I went to Donner Lake with Dad',
        parent_id: parent.id,
        relation_type: 'revision',
      }).then(() => {
        mountDetail(parent.id)

        cy.findByText(/Version 2 of 2/).should('be.visible')
        cy.findByText('I went to Donner Lake with Dad').should('be.visible')
      })
    })
  })

  it('shows an incoming connection on the entry it points at', () => {
    seed({ content: 'Started the degree' }).then((target) => {
      seed({ content: 'Left my job' }).then((source) => {
        seed({
          content: 'One made the other possible',
          parent_id: source.id,
          target_id: target.id,
          relation_type: 'connection',
          metadata: { connection_label: 'led_to' },
        }).then(() => {
          mountDetail(target.id)

          cy.findByRole('link', { name: 'led_to' }).should('be.visible')
        })
      })
    })
  })

  it('reports a missing entry instead of failing silently', () => {
    mountDetail('does-not-exist')

    cy.findByText('Entry not found.').should('be.visible')
  })

  it('adds an unanchored note about the entry as a whole', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByText(PARENT_TEXT).should('be.visible')

      cy.findByLabelText('Your note').type('Still think about this trip')
      cy.findByRole('button', { name: 'Add entry' }).click()

      cy.findByText('Still think about this trip').should('be.visible')
      cy.then(() => repository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.anchors).to.deep.equal([])
      })
    })
  })

  it('anchors a strike to the passage the user selected', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByText(PARENT_TEXT).should('be.visible')

      selectRange(10, 20)

      cy.findByText('“Lake Tahoe”').should('be.visible')

      cy.findByRole('combobox', { name: 'Anchor action' }).select('strike')
      cy.findByLabelText('Your note').type('Wrong lake')
      cy.findByLabelText('Replacement wording').type('Donner Lake')
      cy.findByRole('button', { name: 'Add entry' }).click()

      cy.findByText('Strikes “Lake Tahoe”').should('be.visible')
      cy.findByText('Adds “Donner Lake”').should('be.visible')

      cy.then(() => repository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.anchors).to.have.length(2)
        expect(children[0]?.anchors[0]).to.include({ kind: 'strike' })
      })
    })
  })

  it('revises an entry by appending a version, leaving the original row untouched', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Revise' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end}, or so I remembered it.')
      cy.findByRole('button', { name: 'Save revision' }).click()

      cy.findByText(/Version 2 of 2/).should('be.visible')

      cy.then(() => repository.listRevisions(parent.id)).then((revisions) => {
        expect(docToPlainText(revisions[0]!.content)).to.equal(
          `${PARENT_TEXT}, or so I remembered it.`,
        )
        expect(revisions[0]?.authoring_trace?.steps.length).to.be.greaterThan(0)
      })
      // The entry itself is never rewritten; the version chain is what carries the change.
      cy.then(() => repository.getById(parent.id)).then((stored) => {
        expect(stored?.content).to.equal(PARENT_TEXT)
      })
    })
  })

  it('abandons a revision without touching the entry', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Revise' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end} — actually never mind')
      cy.findByRole('button', { name: 'Discard revision' }).click()

      cy.findByText(PARENT_TEXT).should('be.visible')
      cy.then(() => repository.listRevisions(parent.id)).then((revisions) => {
        expect(revisions).to.have.length(0)
      })
    })
  })

  it('creates an outgoing connection to another entry', () => {
    seed({ content: 'Left my job' }).then((source) => {
      seed({ content: 'Started the degree' }).then((destination) => {
        mountDetail(source.id)

        cy.findByText('Left my job').should('be.visible')

        cy.findByLabelText('Connect to').select(destination.id)
        cy.findByLabelText('How they relate').type('led_to')
        cy.findByLabelText('Why they relate').type('One made the other possible')
        cy.findByRole('button', { name: 'Add connection' }).click()

        cy.findByRole('link', { name: 'led_to' }).should('be.visible')

        cy.then(() => repository.listConnectionsFor(source.id)).then((connections) => {
          expect(connections[0]?.target_id).to.equal(destination.id)
        })
      })
    })
  })

  it('renders an entry’s attachments from the media store', () => {
    cy.then(() =>
      media.put(new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })),
    ).then((mediaRef) => {
      seed({ content: PARENT_TEXT, media_refs: [mediaRef] }).then((parent) => {
        mountDetail(parent.id)

        // A blob URL, minted from the media store for this page load. Regex because the id in it
        // is generated by the browser and cannot be written down here.
        cy.findByRole('img', { name: 'Attached image' })
          .should('be.visible')
          .and('have.attr', 'src')
          .and('match', /^blob:/)
      })
    })
  })
})

/** Selects a character range inside the rendered entry text and tells the view about it. */
function selectRange(from: number, to: number): void {
  cy.findByTestId('entry-content').then(($content) => {
    const content = $content[0]
    const textNode = content?.firstChild
    if (!content || !textNode) throw new Error('Entry content was not rendered')

    const range = content.ownerDocument.createRange()
    range.setStart(textNode, from)
    range.setEnd(textNode, to)

    const selection = content.ownerDocument.defaultView?.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    content.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}
