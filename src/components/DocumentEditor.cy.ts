import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { anchorsPlacedSince, collectAnchors } from '@/domain/anchors'
import { AuthoringSession } from '@/domain/authoringSession'
import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  collectMediaRefs,
  docToPlainText,
  plainTextDocument,
  serializeDocument,
} from '@/domain/entryDocument'
import { documentsAt } from '@/editor/replay'
import { freshMediaRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { selectTextRange } from '@/testing/selectTextRange'

/** The change this component last reported, which is its whole contract with a parent. */
function lastChange(stub: unknown): EditorChange {
  const calls = (stub as { args: [EditorChange][] }).args
  return calls[calls.length - 1]![0]
}

/** Seals every change reported into a trace, the way a draft does, and replays it to the end. */
function replayAll(base: string, stub: unknown) {
  const session = new AuthoringSession('session-1', '2026-09-22T10:00:00.000Z', base)
  for (const [change] of (stub as { args: [EditorChange][] }).args) session.record(change)
  const trace = session.seal()!
  return documentsAt(trace, [trace.events.length])
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
      expect(change.is_formatting).to.equal(false)
    })
  })

  it('reports the title beside the body it types into, as a separate field', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')
    cy.findByRole('textbox', { name: 'New entry' }).type('We drove up on Friday.')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(change.title).to.equal('Lake Tahoe')
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
      expect(change.title).to.equal('Lake Tahoe')
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
      expect(change.title).to.equal('Lake Tahoe')
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

    // The title is not in the editor's document at all, so a block-type command cannot reach it.
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.get('@change').then((stub) => {
      expect(lastChange(stub).title).to.equal('Lake Tahoe')
    })
  })

  it('reports a formatting change as formatting, since it inserts no words', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('Worth remembering{selectall}')
    cy.findByRole('button', { name: 'Bold' }).click()

    cy.get('@change').then((stub) => {
      expect(lastChange(stub).is_formatting).to.equal(true)
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
      expect(change.is_formatting).to.equal(true)
      // Trimmed because the editor adds an empty block after a trailing heading, which is its
      // scaffolding rather than anything the author wrote.
      expect(docToPlainText(change.content).trim()).to.equal('Worth remembering')
    })
  })

  it('reports no deletion for wrapping a paragraph in a list', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('Worth remembering{selectall}')
    cy.findByRole('button', { name: 'List' }).click()

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      // Wrapping arrives as a `replaceAround` spanning the whole paragraph, with its content
      // reinserted through the gap — naive arithmetic would report the paragraph as deleted.
      expect(docToPlainText(change.content).trim()).to.equal('Worth remembering')
      expect(change.removed_chars).to.equal(0)
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

  it('reports a title change, but produces no steps for it', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', withTitle: true },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'Title' }).type('Lake Tahoe')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(change.title).to.equal('Lake Tahoe')
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
        title: 'Lake Tahoe',
        content: serializeDocument(plainTextDocument('We drove up on Friday.')),
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
      expect(lastChange(stub).is_formatting).to.equal(true)
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

  it('holds the paragraph it adds after a trailing heading until the writer changes something', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: {
        label: 'New entry',
        content: serializeDocument({
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Lake Tahoe' }],
            },
          ],
        }),
      },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'New entry' }).click()
    cy.get('@change').should('not.have.been.called')

    cy.findByRole('textbox', { name: 'New entry' }).type('!')
    // The editor's own paragraph, then the keystroke.
    cy.get('@change').should('have.been.calledOnce')
    cy.get('@change').then((stub) => expect(lastChange(stub).steps).to.have.length(2))
  })

  it('opens an existing document where its author left it', () => {
    cy.mount(DocumentEditor, {
      props: {
        label: 'New entry',
        withTitle: true,
        title: 'Lake Tahoe',
        content: serializeDocument(plainTextDocument('We drove up on Friday.')),
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
      expect(change.is_formatting).to.equal(false)
      expect(change.media_changed).to.equal(true)
      // The bytes never enter the document: an object URL is minted per page load and would be a
      // broken reference the moment this entry was read again.
      expect(change.content).to.not.contain('blob:')
      expect(change.content).to.not.contain('data:')
    })
  })

  it('bookmarks a paste, distinct from ordinary typing', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })
    cy.findByRole('textbox', { name: 'New entry' }).click()

    // Neither runner has a first-class paste: ProseMirror's own view reads `event.clipboardData`
    // straight off whatever `paste` event its DOM node receives, trusted or not, so a hand-built
    // `ClipboardEvent` carrying a `DataTransfer` is dispatched directly at the contenteditable.
    cy.findByRole('textbox', { name: 'New entry' }).then(($editor) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', 'Copied from elsewhere')
      $editor[0]!.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }),
      )
    })

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docToPlainText(change.content)).to.contain('Copied from elsewhere')
      expect(change.is_paste).to.equal(true)
    })
  })

  it('reports every step it takes, so the sealed log replays to the document exactly', () => {
    const onChange = cy.stub().as('change')
    // Ending in a heading makes the editor append an empty paragraph on its own, the first time
    // anything happens in it.
    const base = serializeDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lake Tahoe' }] },
      ],
    })

    cy.mount(DocumentEditor, { props: { label: 'New entry', content: base }, attrs: { onChange } })

    // A link typed out in full, then a space, is turned into a link by the editor itself.
    cy.findByRole('textbox', { name: 'New entry' }).type(
      '{ctrl+end}See https://example.com today.{selectall}',
    )
    cy.findByRole('button', { name: 'Bold' }).click()
    cy.findByRole('textbox', { name: 'New entry' })
      .type('{ctrl+end}')
      .then(($editor) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', ' Copied from elsewhere')
        $editor[0]!.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }),
        )
      })
    cy.findByRole('textbox', { name: 'New entry' }).type('{ctrl+z}')
    // Clearing everything makes the editor reset what's left to a plain paragraph on its own.
    cy.findByRole('textbox', { name: 'New entry' }).type('{selectall}{backspace}Starting over.')

    cy.get('@change').then((stub) => {
      expect(replayAll(base, stub)).to.deep.equal([JSON.parse(lastChange(stub).content)])
    })
  })

  describe('anchor mode', () => {
    function mountAnchorEditor(
      onChange: (change: EditorChange) => void,
      content?: string,
      props: Record<string, unknown> = {},
    ) {
      cy.mount(DocumentEditor, {
        props: {
          label: 'New entry',
          anchorMode: true,
          content: content ?? serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad')),
          ...props,
        },
        attrs: { onChange },
      })
    }

    /** A document carrying one anchor mark plus its committed wording, sharing one id. */
    function withAnchorMarkAndWording(
      text: string,
      anchorId: string,
      from: number,
      to: number,
      wording: string,
      kind: 'comment' | 'strike' = 'comment',
    ): string {
      return serializeDocument({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: text.slice(0, from) },
              {
                type: 'text',
                text: text.slice(from, to),
                marks: [{ type: ANCHOR_MARK, attrs: { anchorId, kind } }],
              },
              { type: ANCHOR_INSERT_NODE, attrs: { anchorId, text: wording } },
              { type: 'text', text: text.slice(to) },
            ].filter((node) => node.text !== ''),
          },
        ],
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

    it('removes a bare insertion via its own trash button, same as a marked anchor', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 0, 0),
      )
      cy.findByRole('textbox', { name: 'New entry' }).type('perhaps')
      cy.findByRole('button', { name: 'Remove anchor' }).click()

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(change.anchorIds).to.deep.equal([])
        // The node shrinks the document, but its wording was never the parent's text to begin with
        // (`nodeText` skips `anchorInsert`) — `textBetween` over its range reads as empty, not
        // removed.
        expect(change.removed_chars).to.equal(0)
      })
    })

    it('trims whitespace off a selection’s edges before anchoring it', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      // " Lake Tahoe " (9-21) carries a space on both sides of the word "Lake Tahoe" (10-20).
      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 9, 21),
      )
      cy.findByRole('button', { name: 'Highlight' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ quote: 'Lake Tahoe', kind: 'comment' })
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

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(change.anchorIds).to.deep.equal([])
        // Judged by outcome, not by transaction provenance (`contentDelta`): undoing a placement
        // removes the anchor from the document's anchor set the same as `removeAnchor` would, so
        // this reads as an anchor change rather than formatting, with no undo-specific case needed.
        expect(change.is_anchor_op).to.equal(true)
        expect(change.is_formatting).to.equal(false)
      })
    })

    it('reports every step it takes, so the sealed log replays to the document exactly', () => {
      const onChange = cy.stub().as('change')
      const base = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad'))
      mountAnchorEditor(onChange, base)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 10, 20),
      )
      cy.findByRole('button', { name: 'Highlight' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')
      cy.findByRole('button', { name: 'Edit wording' }).click()
      cy.findByRole('button', { name: 'Strike' }).click()
      cy.findByRole('textbox', { name: 'Wording' }).type('{esc}')
      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        selectTextRange($editor[0]!, 0, 0),
      )
      cy.findByRole('textbox', { name: 'New entry' }).type('perhaps{enter}')
      cy.findByRole('textbox', { name: 'New entry' }).type('{ctrl+z}')

      cy.get('@change').then((stub) => {
        expect(replayAll(base, stub)).to.deep.equal([JSON.parse(lastChange(stub).content)])
      })
    })

    describe('editing an anchor already placed this session', () => {
      /** Places a highlight over "Lake Tahoe" and commits "Donner Lake" as its wording. */
      function placeHighlightWithWording() {
        cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
          selectTextRange($editor[0]!, 10, 20),
        )
        cy.findByRole('button', { name: 'Highlight' }).click()
        cy.findByRole('textbox', { name: 'Wording' }).type('Donner Lake{enter}')
      }

      it('reopens a placed anchor’s wording box by clicking it, with the wording already there', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        cy.findByRole('button', { name: 'Edit wording' }).click()
        cy.findByRole('textbox', { name: 'Wording' }).should('have.value', 'Donner Lake')
        cy.findByRole('textbox', { name: 'Wording' }).type('{end} Tahoe{enter}')

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          const [anchor] = collectAnchors(change.content)
          expect(anchor).to.include({ insertion: 'Donner Lake Tahoe' })
          // Typing wording is typing, not a structural anchor op — see `contentDelta`'s
          // `sameAnchors`; it earns a bookmark the same way prose does.
          expect(change.is_anchor_op).to.equal(false)
          expect(change.is_formatting).to.equal(false)
        })
      })

      it('reports a keystroke in a reopened wording box as ordinary text entry', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        cy.findByRole('button', { name: 'Edit wording' }).click()
        cy.findByRole('textbox', { name: 'Wording' }).type('{end}.')

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          expect(change.inserted_text.endsWith('.')).to.equal(true)
          expect(change.is_anchor_op).to.equal(false)
          expect(change.is_formatting).to.equal(false)
        })
      })

      it('switches a placed anchor’s kind from its reopened wording box', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        cy.findByRole('button', { name: 'Edit wording' }).click()
        cy.findByRole('button', { name: 'Strike' }).click()

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          const [anchor] = collectAnchors(change.content)
          expect(anchor).to.include({ kind: 'strike', insertion: 'Donner Lake' })
          expect(change.is_anchor_op).to.equal(true)
        })
      })

      it('removes a placed anchor entirely from its reopened wording box', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()
        cy.get('@change').then((stub) => expect(lastChange(stub).anchorIds).to.have.length(1))

        cy.findByRole('button', { name: 'Edit wording' }).click()
        cy.findByRole('button', { name: 'Remove anchor' }).click()

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          expect(collectAnchors(change.content)).to.deep.equal([])
          expect(change.anchorIds).to.deep.equal([])
          expect(change.is_anchor_op).to.equal(true)
          expect(docToPlainText(change.content)).to.equal('I went to Lake Tahoe with Dad')
        })
      })

      it('restores a reopened anchor’s prior wording on Escape, rather than discarding it', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        cy.findByRole('button', { name: 'Edit wording' }).click()
        cy.findByRole('textbox', { name: 'Wording' }).type('{selectall}Something else entirely')
        cy.get('@change').then((stub) => {
          expect(collectAnchors(lastChange(stub).content)[0]).to.include({
            insertion: 'Something else entirely',
          })
        })

        cy.findByRole('textbox', { name: 'Wording' }).type('{esc}')

        cy.get('@change').then((stub) => {
          const [anchor] = collectAnchors(lastChange(stub).content)
          expect(anchor).to.include({ insertion: 'Donner Lake' })
        })
      })

      it('does not let a click reopen a sealed anchor from an earlier child', () => {
        const onChange = cy.stub().as('change')
        // "sealed-1" stands for an anchor an earlier child already placed and sealed.
        mountAnchorEditor(
          onChange,
          withAnchorMark('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20),
        )

        cy.findByText('Lake Tahoe').click()

        cy.findByRole('button', { name: 'Edit wording' }).should('not.exist')
        cy.get('@change').should('not.have.been.called')
      })

      it('reopens a placed anchor selected exactly, instead of changing its kind or layering a second one over it', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()
        let callsBefore = 0
        cy.get('@change').then((stub) => {
          callsBefore = (stub as unknown as { args: unknown[][] }).args.length
        })

        // The same range the highlight covers, selected again from scratch.
        cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
          selectTextRange($editor[0]!, 10, 20),
        )
        cy.findByRole('button', { name: 'Strike' }).click()

        cy.findByRole('textbox', { name: 'Wording' }).should('have.value', 'Donner Lake')
        cy.get('@change').then((stub) => {
          // Opening the box changes nothing about the document itself, so no new update fires.
          expect((stub as unknown as { args: unknown[][] }).args.length).to.equal(callsBefore)
        })
      })

      it('opens a placed anchor’s box for a selection overlapping it at all, rather than creating a second anchor', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()
        let callsBefore = 0
        cy.get('@change').then((stub) => {
          callsBefore = (stub as unknown as { args: unknown[][] }).args.length
        })

        // "Tahoe with" (15-25) overlaps the placed "Lake Tahoe" highlight (10-20) without matching it.
        cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
          selectTextRange($editor[0]!, 15, 25),
        )
        cy.findByRole('button', { name: 'Highlight' }).click()

        cy.findByRole('textbox', { name: 'Wording' }).should('have.value', 'Donner Lake')
        cy.get('@change').then((stub) => {
          expect((stub as unknown as { args: unknown[][] }).args.length).to.equal(callsBefore)
        })
      })

      it('lets a session placed before a resume keep editing an anchor placed before the resume', () => {
        // Stands for a draft resumed after a reload: "resumed-1" was placed and persisted before
        // the reload, so it's already in the document this editor mounts with.
        const base = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad'))
        const seeded = withAnchorMarkAndWording(
          'I went to Lake Tahoe with Dad',
          'resumed-1',
          10,
          20,
          'Donner Lake',
        )
        // The base — the parent as the session first found it, `Draft.parent.base_content` — is
        // what still tells it apart from an anchor an earlier child sealed.
        expect(anchorsPlacedSince(base, seeded)).to.deep.equal(['resumed-1'])

        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange, seeded, { anchorBaseContent: base })

        cy.findByRole('button', { name: 'Edit wording' }).click()
        cy.findByRole('textbox', { name: 'Wording' }).should('have.value', 'Donner Lake')
        cy.findByRole('textbox', { name: 'Wording' }).type('{esc}')

        cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
          selectTextRange($editor[0]!, 21, 25),
        )
        cy.findByRole('button', { name: 'Highlight' }).click()
        cy.findByRole('textbox', { name: 'Wording' }).type('note{enter}')

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          expect(change.anchorIds).to.include('resumed-1')
          expect(change.anchorIds).to.have.length(2)
        })
      })
    })
  })
})
