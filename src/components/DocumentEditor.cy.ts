import DocumentEditor from '@/components/DocumentEditor.vue'
import {
  collectMediaRefs,
  docTitle,
  docToPlainText,
  plainTextDocument,
  serializeDocument,
} from '@/domain/entryDocument'
import { freshMediaRepository } from '@/testing/realRepositories'

/** The change this component last reported, which is its whole contract with a parent. */
function lastChange(stub: unknown) {
  const calls = (stub as { args: [{ content: string; isFormatting: boolean }][] }).args
  return calls[calls.length - 1]![0]
}

describe('DocumentEditor', () => {
  beforeEach(() => {
    freshMediaRepository()
  })

  it('reports the document it holds along with the steps that produced it', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('It rained all day.')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docToPlainText(change.content)).to.equal('It rained all day.')
      expect(change.isFormatting).to.equal(false)
    })
  })

  it('separates a title from the body, so each ends up where it belongs', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    // Straight onto the empty title line, which the placeholder gives a height to click. Enter
    // then leaves the title for the body rather than splitting the heading in two.
    cy.findByRole('heading').click().type('Lake Tahoe{enter}We drove up on Friday.')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docTitle(change.content)).to.equal('Lake Tahoe')
      expect(docToPlainText(change.content)).to.equal('We drove up on Friday.')
    })
  })

  it('survives Enter over a selection covering the title, which cannot be split', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('heading')
      .click()
      .type('Lake Tahoe{enter}We drove up.')
      .type('{ctrl+a}{enter}Starting over.')

    cy.get('@change').then((stub) => {
      expect(docToPlainText(lastChange(stub).content)).to.equal('Starting over.')
    })
  })

  it('reports a formatting change as formatting, since it inserts no words', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('Worth remembering{selectall}')
    cy.findByRole('button', { name: 'Bold' }).click()

    cy.get('@change').then((stub) => {
      expect(lastChange(stub).isFormatting).to.equal(true)
    })
  })

  it('reports a change of block type as formatting, since it moves no words', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('Worth remembering{selectall}')
    cy.findByRole('button', { name: 'Heading' }).click()

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      // A heading arrives as a replaceAround step, which no step type tells apart from an edit.
      expect(change.isFormatting).to.equal(true)
      // Trimmed because the editor adds an empty block after a trailing heading, which is its
      // scaffolding rather than anything the author wrote.
      expect(docToPlainText(change.content).trim()).to.equal('Worth remembering')
    })
  })

  it('leaves the caret in the document after a toolbar click, so typing carries on', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('Worth remembering')
    cy.findByRole('button', { name: 'Quote' }).click()
    cy.focused().type(', and worth keeping')

    cy.get('@change').then((stub) => {
      expect(docToPlainText(lastChange(stub).content).trim()).to.equal(
        'Worth remembering, and worth keeping',
      )
    })
  })

  it('reports typing a title as an edit, since a title is content', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('heading').click().type('Lake Tahoe')

    cy.get('@change').then((stub) => {
      expect(lastChange(stub).isFormatting).to.equal(false)
    })
  })

  it('turns a selection into a link at the address it is given', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('The trail report{selectall}')
    cy.findByRole('button', { name: 'Link' }).click()
    cy.findByLabelText('Link address').type('https://example.com/trail')
    cy.findByRole('button', { name: 'Apply link' }).click()

    cy.findByRole('link', { name: 'The trail report' })
      .should('be.visible')
      .and('have.attr', 'href', 'https://example.com/trail')

    cy.get('@change').then((stub) => {
      expect(lastChange(stub).isFormatting).to.equal(true)
    })
  })

  it('reports nothing when only its editability changes', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true, disabled: true },
      attrs: { onChange },
    }).then(({ wrapper }) => wrapper.setProps({ disabled: false }))

    // Whether a document may be edited is not a change to the document. Reporting one starts a
    // writing session nobody began, which showed up as an empty draft per visit to the page.
    cy.get('@change').should('not.have.been.called')
  })

  it('opens an existing document where its author left it', () => {
    cy.mount(DocumentEditor, {
      props: {
        label: 'New entry',
        withTitle: true,
        content: serializeDocument(plainTextDocument('We drove up on Friday.', 'Lake Tahoe')),
      },
    })

    cy.findByRole('heading', { name: 'Lake Tahoe' }).should('be.visible')
    cy.findByText('We drove up on Friday.').should('be.visible')
  })

  it('stores an attached image in the media store and refers to it by id alone', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    // The input is visually hidden behind the toolbar button, which is why this is forced.
    cy.findByLabelText('Attach an image').selectFile(
      {
        contents: Cypress.Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        fileName: 'lake.png',
        mimeType: 'image/png',
      },
      { force: true },
    )

    cy.findByRole('img').should('be.visible')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(collectMediaRefs(change.content)).to.have.length(1)
      // An attachment adds no words, but it is content all the same.
      expect(change.isFormatting).to.equal(false)
      // The bytes never enter the document: an object URL is minted per page load and would be a
      // broken reference the moment this entry was read again.
      expect(change.content).to.not.contain('blob:')
      expect(change.content).to.not.contain('data:')
    })
  })
})
