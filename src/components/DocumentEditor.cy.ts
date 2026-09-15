import DocumentEditor from '@/components/DocumentEditor.vue'
import { collectAnchors } from '@/domain/anchors'
import {
  collectMediaRefs,
  docTitle,
  docToPlainText,
  plainTextDocument,
  serializeDocument,
} from '@/domain/entryDocument'
import { freshMediaRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { selectTextRange } from '@/testing/selectTextRange'

interface ObservedChange {
  content: string
  steps: unknown[]
  isFormatting: boolean
  anchorIds?: string[]
}

/** The change this component last reported, which is its whole contract with a parent. */
function lastChange(stub: unknown): ObservedChange {
  const calls = (stub as { args: [ObservedChange][] }).args
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

  it('joins the title typed beside the editor to the body typed inside it', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    // Two fields, one stored document: the title is an ordinary input, and this is where the two
    // halves come back together.
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docTitle(change.content)).to.equal('Lake Tahoe')
      expect(docToPlainText(change.content)).to.equal('We drove up on Friday.')
    })
  })

  it('moves from the title into the body on Enter, rather than submitting the form', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe{enter}')
    cy.focused().type('We drove up on Friday.')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docTitle(change.content)).to.equal('Lake Tahoe')
      expect(docToPlainText(change.content)).to.equal('We drove up on Friday.')
    })
  })

  it('moves from the title into the body on Tab, skipping the toolbar between them', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    // Cypress's `.type()` has no `{tab}` sequence (cypress-io/cypress#299), so the keydown the
    // title field listens for is dispatched directly, on whichever element has focus.
    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.focused().trigger('keydown', {
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
      which: 9,
      bubbles: true,
      cancelable: true,
    })
    cy.focused().type('We drove up on Friday.')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docTitle(change.content)).to.equal('Lake Tahoe')
      expect(docToPlainText(change.content)).to.equal('We drove up on Friday.')
    })
  })

  it('leaves the title untouched by the toolbar, which is the body’s alone', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.{selectall}')
    cy.findByRole('combobox', { name: 'Text style' }).select('Heading')

    // The title is not in the editor's document at all, so a block-type command cannot reach it —
    // where a title node sitting first in that document could be replaced by one.
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.get('@change').then((stub) => {
      expect(docTitle(lastChange(stub).content)).to.equal('Lake Tahoe')
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
    cy.findByRole('combobox', { name: 'Text style' }).select('Heading')

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

  it('reports a title as content, but produces no steps for it', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docTitle(change.content)).to.equal('Lake Tahoe')
      // The title is a plain field beside the editor, so there is no step chain it belongs to. Its
      // history is the value at each save point, read back from the entry's version chain.
      expect(change.steps).to.deep.equal([])
    })
  })

  it('shows a disabled entry’s title as text, not a textbox someone could try to type into', () => {
    cy.mount(DocumentEditor, {
      props: {
        label: 'New entry',
        withTitle: true,
        disabled: true,
        content: serializeDocument(plainTextDocument('We drove up on Friday.', 'Lake Tahoe')),
      },
    })

    cy.findByRole('textbox', { name: 'Title' }).should('not.exist')
    cy.findByText('Lake Tahoe').should('be.visible')
  })

  it('omits the title entirely once it is not editable and was never given one', () => {
    cy.mount(DocumentEditor, { props: { label: 'New entry', withTitle: true, disabled: true } })

    cy.findByRole('textbox', { name: 'Title' }).should('not.exist')
    cy.findByText('Lake Tahoe').should('not.exist')
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

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
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

  describe('anchor mode', () => {
    function mountAnchorEditor(onChange: (change: ObservedChange) => void, content?: string) {
      cy.mount(DocumentEditor, {
        props: {
          label: 'New entry',
          anchorMode: true,
          content: content ?? serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad')),
        },
        attrs: { onChange },
      })
    }

    it('offers the anchor menu over a selection instead of ordinary formatting', () => {
      mountAnchorEditor(() => {})

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('button', { name: 'Highlight' }).should('be.visible')
      cy.findByRole('button', { name: 'Bold' }).should('not.exist')
    })

    it('marks a selection as a highlight, types wording, and accepts it as one gesture', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('button', { name: 'Highlight' }).click()
      // The box opens already focused, empty, and ready — typing continues there, not back in the
      // document (re-selecting "New entry" would refocus it and strand this keystroke elsewhere).
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(change.anchorIds).to.have.length(1)
        const [anchor] = collectAnchors(change.content)
        expect(anchor).to.include({
          kind: 'comment',
          quote: 'Lake Tahoe',
          insertion: 'Donner Lake',
        })
        expect(docToPlainText(change.content)).to.equal('I went to Lake Tahoe with Dad')
      })
    })

    it('pairs a strike with replacement wording under one anchor id', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('button', { name: 'Strike' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(change.anchorIds).to.have.length(1)
        const [anchor] = collectAnchors(change.content)
        expect(anchor).to.include({ kind: 'strike', quote: 'Lake Tahoe', insertion: 'Donner Lake' })
        expect(docToPlainText(change.content)).to.equal('I went to Lake Tahoe with Dad')
      })
    })

    it('places a bare insertion at the caret when nothing is selected', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 0, 0),
      )
      cy.findByRole('textbox', { name: 'New entry' }).type('perhaps{enter}')

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(change.anchorIds).to.have.length(1)
        const [anchor] = collectAnchors(change.content)
        expect(anchor).to.include({ kind: null, insertion: 'perhaps' })
      })
    })

    it('places a highlight and its wording through the keyboard alone', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('textbox', { name: 'New entry' }).type('{ctrl+alt+h}Donner Lake{enter}')

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        const [anchor] = collectAnchors(change.content)
        expect(anchor).to.include({ kind: 'comment', insertion: 'Donner Lake' })
      })
    })

    it('discards an open wording input on Escape', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('button', { name: 'Highlight' }).click()
      cy.findByRole('textbox', { name: 'New entry' }).type('Donner{esc}')

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ kind: 'comment', insertion: null })
      })
    })

    it('does not let wording typed after a sealed anchor absorb it', () => {
      const onChange = cy.stub().as('change')
      // "sealed-1" stands for an anchor an earlier child already placed and sealed — present in
      // the document this editor opened with, not something this session placed.
      mountAnchorEditor(
        onChange,
        withAnchorMark('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20),
      )

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 20, 20),
      )
      cy.findByRole('textbox', { name: 'New entry' }).type('!')

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        const anchors = collectAnchors(change.content)
        expect(anchors).to.have.length(2)
        expect(anchors.find((anchor) => anchor.anchor_id === 'sealed-1')).to.include({
          insertion: null,
        })
        const bare = anchors.find((anchor) => anchor.anchor_id !== 'sealed-1')
        expect(bare).to.include({ kind: null, insertion: '!' })
        expect(change.anchorIds).to.deep.equal([bare?.anchor_id])
      })
    })

    it('drops an anchor back out on undo', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('button', { name: 'Highlight' }).click()
      cy.get('@change').then((stub) => expect(lastChange(stub).anchorIds).to.have.length(1))

      cy.findByRole('textbox', { name: 'New entry' }).type('{ctrl+z}')

      cy.get('@change').then((stub) => expect(lastChange(stub).anchorIds).to.deep.equal([]))
    })
  })
})
