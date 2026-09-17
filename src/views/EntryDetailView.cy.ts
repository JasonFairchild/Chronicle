import EntryDetailView from '@/views/EntryDetailView.vue'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import type { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'
import {
  freshDraftRepository,
  freshEntryRepository,
  freshMediaRepository,
} from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { selectTextRange } from '@/testing/selectTextRange'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { createEntryInput, emptyEntryDates, type Entry } from '@/types/entry'
import { formatDate } from '@/utils/format'

const PARENT_TEXT = 'I went to Lake Tahoe with Dad'
const PARENT_CONTENT = textContent(PARENT_TEXT)

function mountDetail(id: string): Cypress.Chainable {
  return cy.mount(EntryDetailView, { props: { id }, routePath: '/' })
}

// A fresh, isolated real repository per test, pointed at by the composition root, so the mounted
// component's own useEntriesStore() call reaches the same instance this file seeds into.
let repository: DexieEntryRepository
let media: OpfsMediaRepository
let drafts: DexieDraftRepository

/** Seeds the active repository and yields the created entry to the chain. */
function seed(input: Parameters<typeof createEntryInput>[0]): Cypress.Chainable<Entry> {
  return cy.then(() => repository.create(createEntryInput(input)))
}

describe('EntryDetailView', () => {
  beforeEach(() => {
    repository = freshEntryRepository()
    media = freshMediaRepository()
    drafts = freshDraftRepository()
  })

  it('renders the entry’s own text', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByText(PARENT_TEXT).should('be.visible')
    })
  })

  it('shows a child entry separately rather than spliced into the parent', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      seed({
        content: textContent('It was actually Donner Lake'),
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
        content: textContent('Wrong lake'),
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
        content: textContent('Wrong lake'),
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        seed({
          content: textContent('I stayed home that summer'),
          parent_id: parent.id,
          relation_type: 'revision',
          revision_mode: 'direct',
        }).then(() => {
          mountDetail(parent.id)

          cy.findByText('Was attached to: “Lake Tahoe”').should('be.visible')
        })
      })
    })
  })

  it('reports the version position once an entry has been revised', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      seed({
        content: textContent('I went to Donner Lake with Dad'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
      }).then(() => {
        mountDetail(parent.id)

        cy.findByText(/Version 2 of 2/).should('be.visible')
        cy.findByText('I went to Donner Lake with Dad').should('be.visible')
      })
    })
  })

  it('shows an incoming connection on the entry it points at', () => {
    seed({ content: textContent('Started the degree') }).then((target) => {
      seed({ content: textContent('Left my job') }).then((source) => {
        seed({
          content: textContent('One made the other possible'),
          title: 'led_to',
          parent_id: source.id,
          target_id: target.id,
          relation_type: 'connection',
        }).then(() => {
          mountDetail(target.id)

          cy.findByRole('link', { name: 'led_to' }).should('be.visible')
        })
      })
    })
  })

  it('shows a child card’s created date', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      seed({
        content: textContent('It was actually Donner Lake'),
        parent_id: parent.id,
        relation_type: 'update',
      }).then((child) => {
        mountDetail(parent.id)

        cy.findByText(formatDate(child.created_at)).should('be.visible')
      })
    })
  })

  it('opens the connection’s own page, not the far endpoint, when its card is clicked', () => {
    seed({ content: textContent('Started the degree') }).then((target) => {
      seed({ content: textContent('Left my job') }).then((source) => {
        seed({
          content: textContent('One made the other possible'),
          title: 'led_to',
          parent_id: source.id,
          target_id: target.id,
          relation_type: 'connection',
        }).then((connection) => {
          mountDetail(target.id)

          cy.findByRole('link', { name: 'led_to' }).should(
            'have.attr',
            'href',
            `/entries/${connection.id}`,
          )
        })
      })
    })
  })

  it('shows a breadcrumb back to the parent on a child’s own detail page', () => {
    seed({ content: textContent('Left my job'), title: 'Career change' }).then((parent) => {
      seed({
        content: textContent('Started the degree'),
        parent_id: parent.id,
        relation_type: 'update',
      }).then((child) => {
        mountDetail(child.id)

        cy.findByText('About').should('be.visible')
        cy.findByRole('link', { name: 'Career change' }).should(
          'have.attr',
          'href',
          `/entries/${parent.id}`,
        )
      })
    })
  })

  it('shows a breadcrumb linking both sides on a connection’s own detail page', () => {
    seed({ content: textContent('Started the degree') }).then((target) => {
      seed({ content: textContent('Left my job') }).then((source) => {
        seed({
          content: textContent('One made the other possible'),
          title: 'led_to',
          parent_id: source.id,
          target_id: target.id,
          relation_type: 'connection',
        }).then((connection) => {
          mountDetail(connection.id)

          cy.findByText('Connects').should('be.visible')
          cy.findByRole('link', { name: 'Left my job' }).should(
            'have.attr',
            'href',
            `/entries/${source.id}`,
          )
          cy.findByRole('link', { name: 'Started the degree' }).should(
            'have.attr',
            'href',
            `/entries/${target.id}`,
          )
        })
      })
    })
  })

  it('reports a missing entry instead of failing silently', () => {
    mountDetail('does-not-exist')

    cy.findByText('Entry not found.').should('be.visible')
  })

  it('shows the dates the writer gave, alongside when the entry was created', () => {
    seed({
      content: PARENT_CONTENT,
      dates: {
        ...emptyEntryDates(),
        occurred_at: '1994-06-11',
        occurred_time_note: 'late morning',
        recorded_at: '1994-06-12',
      },
    }).then((parent) => {
      mountDetail(parent.id)

      cy.findByText(/Happened .*1994 · late morning/).should('be.visible')
      cy.findByText(/Originally written .*1994/).should('be.visible')
    })
  })

  it('adds a note about the entry as a whole when the session marks nothing', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      cy.findByRole('textbox', { name: 'Your note' }).type('Still think about this trip')
      cy.findByRole('button', { name: 'Add entry' }).click()

      cy.findByText('Still think about this trip').should('be.visible')
      cy.then(() => repository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.anchors).to.deep.equal([])
        // Nothing was marked, so the note claims nothing changed about the entry.
        expect(children[0]?.relation_type).to.equal('annotation')
      })
    })
  })

  it('will not save a related entry that says nothing', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      // Typed into and then emptied: the document is no longer the blank one the session opened
      // with, but it still holds nothing worth keeping.
      cy.findByRole('textbox', { name: 'Your note' }).type('x{backspace}')

      cy.findByRole('button', { name: 'Add entry' }).should('be.disabled')
      cy.then(() => repository.listChildren(parent.id)).then((children) => {
        expect(children).to.have.length(0)
      })
      cy.findByRole('button', { name: 'Discard' }).click()
    })
  })

  it('keeps a related entry in progress when the reader moves to another entry', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      seed({ content: textContent('A different day entirely') }).then((other) => {
        mountDetail(parent.id).then(({ wrapper }) => {
          cy.findByRole('button', { name: 'Create related entry' }).click()
          cy.findByRole('textbox', { name: 'Your note' }).type('Half a thought about this')

          // The session has to close — saving after this would seal against the wrong entry — but
          // closing it is not the same as throwing it away.
          cy.then(() => wrapper.setProps({ id: other.id }))
        })

        cy.then(() => drafts.list()).then((saved) => {
          expect(saved[0]?.target).to.deep.equal({ kind: 'new_child', parent_id: parent.id })
          expect(docToPlainText(saved[0]!.child.content)).to.equal('Half a thought about this')
        })
      })
    })
  })

  it('shows the parent’s own title in the anchor-mode composer, not just its body', () => {
    seed({ content: PARENT_CONTENT, title: 'The Tahoe trip' }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      // The page heading reads the parent's title too, so this checks specifically inside the
      // anchor-mode composer's own "Entry being annotated" half, which used to open blank —
      // nothing ever seeded `parentTitle` for it — rather than reading the entry's actual name.
      cy.findByRole('textbox', { name: 'Entry being annotated' })
        .closest('.rounded-lg')
        .should('contain.text', 'The Tahoe trip')
    })
  })

  it('anchors a strike to the passage the user selects, in one atomic seal', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      cy.findByRole('textbox', { name: 'Entry being annotated' })
        .should('be.visible')
        .then(($editor) => selectTextRange($editor[0]!, 10, 20))

      cy.findByRole('button', { name: 'Strike' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

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
        // Striking reports a correction, so the note reads as an update without anyone being asked.
        expect(children[0]?.relation_type).to.equal('update')
      })
    })
  })

  it('pairs a highlight with inline wording, which is what a highlight-plus-comment reads as', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Create related entry' }).click()

      cy.findByRole('textbox', { name: 'Entry being annotated' })
        .should('be.visible')
        .then(($editor) => selectTextRange($editor[0]!, 10, 20))

      cy.findByRole('button', { name: 'Highlight' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

      cy.findByRole('textbox', { name: 'Your note' }).type('Actually')
      cy.findByRole('button', { name: 'Add entry' }).click()

      // A highlight is a mark on existing text, same as a strike — wording rides along with it the
      // same way, which is what `describeAnchor`'s `comment` case needed its own branch for.
      cy.findByText('On “Lake Tahoe”, adds “Donner Lake”').should('be.visible')

      cy.then(() => repository.listChildren(parent.id)).then((children) => {
        expect(children[0]?.relation_type).to.equal('update')
      })
    })
  })

  it('warns before saving a revision that changes the text under an anchor', () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')

    seed({ content: marked }).then((parent) => {
      seed({
        content: textContent('Wonderful trip'),
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        mountDetail(parent.id)

        cy.findByRole('button', { name: 'Revise entry' }).click()
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
        content: textContent('Wonderful trip'),
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }).then(() => {
        mountDetail(parent.id)

        cy.findByRole('button', { name: 'Revise entry' }).click()
        cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end}!')

        cy.findByText(/This changes the passage/).should('not.exist')
        cy.findByRole('button', { name: 'Discard revision' }).click()
      })
    })
  })

  it('revises an entry by appending a version, leaving the original row untouched', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Revise entry' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end}, or so I remembered it.')
      cy.findByRole('button', { name: 'Save revision' }).click()

      cy.findByText(/Version 2 of 2/).should('be.visible')

      cy.then(() => repository.listRevisions(parent.id)).then((revisions) => {
        expect(docToPlainText(revisions[0]!.content)).to.equal(
          `${PARENT_TEXT}, or so I remembered it.`,
        )
        expect(revisions[0]?.revision_mode).to.equal('direct')
        expect(revisions[0]?.authoring_trace?.steps.length).to.be.greaterThan(0)
      })
      // The entry itself is never rewritten; the version chain is what carries the change.
      cy.then(() => repository.getById(parent.id)).then((stored) => {
        expect(docToPlainText(stored!.content)).to.equal(PARENT_TEXT)
      })
    })
  })

  it('abandons a revision without touching the entry', () => {
    seed({ content: PARENT_CONTENT }).then((parent) => {
      mountDetail(parent.id)

      cy.findByRole('button', { name: 'Revise entry' }).click()
      cy.findByRole('textbox', { name: 'Revised entry' }).type('{ctrl+end} — actually never mind')
      cy.findByRole('button', { name: 'Discard revision' }).click()

      cy.findByText(PARENT_TEXT).should('be.visible')
      cy.then(() => repository.listRevisions(parent.id)).then((revisions) => {
        expect(revisions).to.have.length(0)
      })
    })
  })

  // "Navigates to a dedicated screen to add a connection" is proven in the Vitest browser spec
  // only: `cy.mount`'s router is created inside the command and never handed back, so there's
  // nothing here to inspect the post-navigation route on, unlike `createTestRouter()` called
  // directly in a Vitest spec. Creating a connection itself is covered by NewConnectionView.cy.ts.

  it('renders an entry’s attachments from the media store', () => {
    cy.then(() =>
      media.put(new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })),
    ).then((mediaRef) => {
      seed({ content: PARENT_CONTENT, media_refs: [mediaRef] }).then((parent) => {
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
