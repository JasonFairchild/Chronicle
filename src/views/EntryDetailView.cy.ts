import EntryDetailView from '@/views/EntryDetailView.vue'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import type { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'
import {
  freshDraftRepository,
  freshEntryRepository,
  freshMediaRepository,
} from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { selectTextRange } from '@/testing/selectTextRange'
import { docToPlainText } from '@/domain/entryDocument'
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
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'strike')

    seed({ content: marked }).then((parent) => {
      seed({
        content: 'Wrong lake',
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        mountDetail(parent.id)

        cy.findByText('Strikes “Lake Tahoe”').should('be.visible')
      })
    })
  })

  it('keeps the original wording visible when a revision orphans an anchor', () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'strike')

    seed({ content: marked }).then((parent) => {
      seed({
        content: 'Wrong lake',
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        seed({
          content: 'I stayed home that summer',
          parent_id: parent.id,
          relation_type: 'revision',
          revision_mode: 'text',
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
        revision_mode: 'text',
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

  it('anchors a strike to the passage the user selects, in one atomic seal', () => {
    seed({ content: PARENT_TEXT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Anchor an update to a passage' }).click()

      cy.findByRole('textbox', { name: 'Entry being annotated' })
        .should('be.visible')
        .then(($editor) => selectTextRange($editor[0]!, 10, 20))

      cy.findByRole('button', { name: 'Strike selection' }).click()
      cy.findByLabelText('Replacement wording').should('be.visible').type('Donner Lake')
      cy.findByRole('button', { name: 'Insert' }).click()

      cy.findByRole('textbox', { name: 'Your note' }).type('Wrong lake')
      cy.findByRole('button', { name: 'Add entry' }).click()

      cy.findByText('Strikes “Lake Tahoe”, replaced with “Donner Lake”').should('be.visible')

      cy.then(() => repository.listRevisions(parent.id)).then((revisions) => {
        expect(revisions).to.have.length(1)
        expect(revisions[0]?.revision_mode).to.equal('anchor')
      })
      cy.then(() => repository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.anchors).to.have.length(1)
        expect(children[0]?.anchors[0]?.quote).to.equal('Lake Tahoe')
      })
    })
  })

  it('warns before saving a revision that changes the text under an anchor', () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')

    seed({ content: marked }).then((parent) => {
      seed({
        content: 'Wonderful trip',
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        mountDetail(parent.id)

        cy.findByRole('button', { name: 'Revise' }).click()
        cy.findByRole('textbox', { name: 'Revised entry' }).then(($editor) => {
          const el = $editor[0]!
          el.focus()
          selectTextRange(el, 10, 20)
        })
        cy.focused().type('{backspace}')

        cy.findByText(/This changes the passage/).should('be.visible')
        cy.findByText('Wonderful trip').should('be.visible')
        cy.findByRole('button', { name: 'Discard revision' }).click()
      })
    })
  })

  it('stays quiet when a revision only moves an anchor, not the text it covers', () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')

    seed({ content: marked }).then((parent) => {
      seed({
        content: 'Wonderful trip',
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        mountDetail(parent.id)

        cy.findByRole('button', { name: 'Revise' }).click()
        cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end}!')

        cy.findByText(/This changes the passage/).should('not.exist')
        cy.findByRole('button', { name: 'Discard revision' }).click()
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
        expect(revisions[0]?.revision_mode).to.equal('text')
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
