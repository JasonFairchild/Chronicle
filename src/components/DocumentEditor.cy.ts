import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { anchorsPlacedSince, collectAnchors } from '@/domain/anchors'
import { collectMediaRefs, docToPlainText, MEDIA_NODE } from '@/domain/entryDocument'
import { TraceRecorder } from '@/domain/traceRecorder'
import { documentsAt } from '@/editor/replay'
import { mediaRepository } from '@/repositories'
import { withAnchorMark, withAnchorWording } from '@/testing/anchorFixtures'
import { plainTextDocument, serializeDocument } from '@/testing/documents'
import { selectTextRange } from '@/testing/selectTextRange'

/** The change this component last reported, which is its whole contract with a parent. */
function lastChange(stub: unknown): EditorChange {
  const calls = (stub as { args: [EditorChange][] }).args
  return calls[calls.length - 1]![0]
}

/** Seals every change reported into a trace, the way a draft does, and replays it to the end. */
function replayAll(base: string, stub: unknown) {
  const recorder = new TraceRecorder('session-1', '2026-09-22T10:00:00.000Z')
  for (const [change] of (stub as { args: [EditorChange][] }).args) recorder.record(change)
  const { events } = recorder.seal()!
  return documentsAt({ base_content: base, events }, [events.length])
}

/** Neither runner has a first-class paste, so a hand-built one goes straight at the document. */
function paste(editorEl: Element, data: Record<string, string>): void {
  const dataTransfer = new DataTransfer()
  for (const [type, value] of Object.entries(data)) dataTransfer.setData(type, value)
  editorEl.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }),
  )
}

describe('DocumentEditor', () => {
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

  it('shows a document that is only displayed as text, with no toolbar or field to type in', () => {
    cy.mount(DocumentEditor, {
      props: {
        label: 'Entry content',
        displayOnly: true,
        content: serializeDocument(plainTextDocument('We drove up on Friday.')),
      },
    })

    cy.findByText('We drove up on Friday.').should('be.visible')
    cy.findByRole('toolbar').should('not.exist')
    cy.findByRole('textbox').should('not.exist')
  })

  it('shows a stored image in a displayed document', () => {
    cy.then(() =>
      mediaRepository.put(
        new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
      ),
    ).then((mediaRef) => {
      cy.mount(DocumentEditor, {
        props: {
          label: 'Entry content',
          displayOnly: true,
          content: serializeDocument({
            type: 'doc',
            content: [{ type: MEDIA_NODE, attrs: { mediaRef, alt: 'lake.png' } }],
          }),
        },
      })
    })

    cy.findByRole('img', { name: 'lake.png' })
      .should('have.attr', 'src')
      .and('match', /^blob:/)
  })

  it('reports a link as formatting', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    cy.findByRole('textbox', { name: 'New entry' }).type('The trail report{selectall}')
    cy.findByRole('button', { name: 'Link' }).click()
    cy.findByLabelText('Link address').type('https://example.com/trail')
    cy.findByRole('button', { name: 'Apply link' }).click()

    cy.findByRole('link', { name: 'The trail report' }).should('be.visible')

    cy.get('@change').then((stub) => {
      expect(lastChange(stub).is_formatting).to.equal(true)
    })
  })

  it('reports nothing when only its editability changes', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: { label: 'New entry', disabled: true },
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
        content: serializeDocument(plainTextDocument('We drove up on Friday.')),
      },
    })

    cy.findByText('We drove up on Friday.').should('be.visible')
  })

  it('shows an attached image from its stored bytes, and refers to it by id alone', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })

    // Forced because the input is hidden behind Add image.
    cy.findByTestId('image-file-input').selectFile(
      {
        contents: Cypress.Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        fileName: 'lake.png',
        mimeType: 'image/png',
      },
      { force: true },
    )

    cy.findByRole('img')
      .should('have.attr', 'src')
      .and('match', /^blob:/)

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

  it('reports a paste through its own clipboard handling as a paste', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })
    cy.findByRole('textbox', { name: 'New entry' }).click()

    // ProseMirror's own view reads `event.clipboardData` straight off whatever `paste` event its DOM
    // node receives, trusted or not.
    cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
      paste($editor[0]!, { 'text/plain': 'Copied from elsewhere' }),
    )

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docToPlainText(change.content)).to.contain('Copied from elsewhere')
      expect(change.is_paste).to.equal(true)
    })
  })

  it('pastes anchored text without its anchor', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, { props: { label: 'New entry' }, attrs: { onChange } })
    cy.findByRole('textbox', { name: 'New entry' }).click()

    cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
      paste($editor[0]!, {
        'text/html':
          '<p>It <span data-anchor-id="anchor-1" data-anchor-kind="comment">rained</span>' +
          '<ins data-anchor-id="anchor-1">heavily</ins></p>',
      }),
    )

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docToPlainText(change.content)).to.equal('It rainedheavily')
      expect(collectAnchors(change.content)).to.deep.equal([])
    })
  })

  it('keeps the text under an anchor as it was in a revision', () => {
    const onChange = cy.stub().as('change')

    cy.mount(DocumentEditor, {
      props: {
        label: 'New entry',
        content: withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20),
      },
      attrs: { onChange },
    })

    cy.findByRole('textbox', { name: 'New entry' }).then(($editor) => {
      $editor[0]!.focus()
      selectTextRange($editor[0]!, 12, 12)
    })
    cy.focused().type('x')
    // Typing that goes through, after the refused keystroke.
    cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
      selectTextRange($editor[0]!, 29, 29),
    )
    cy.focused().type('!')

    cy.get('@change').then((stub) => {
      const change = lastChange(stub)
      expect(docToPlainText(change.content)).to.equal('I went to Lake Tahoe with Dad!')
      expect(collectAnchors(change.content)[0]).to.include({ quote: 'Lake Tahoe' })
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
      .then(($editor) => paste($editor[0]!, { 'text/plain': ' Copied from elsewhere' }))
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

    function select(from: number, to: number) {
      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) => {
        $editor[0]!.focus()
        selectTextRange($editor[0]!, from, to)
      })
    }

    it('offers the anchor menu over a selection instead of ordinary formatting', () => {
      mountAnchorEditor(() => {})

      select(10, 20)
      cy.findByRole('button', { name: 'Highlight passage' }).should('be.visible')
      cy.findByRole('button', { name: 'Bold' }).should('not.exist')
    })

    it('marks a selection as a highlight, and takes what is typed next as its wording', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(10, 20)
      cy.findByRole('button', { name: 'Highlight passage' }).click()
      cy.findByText('Add wording…').should('be.visible')
      cy.focused().type('Donner Lake')

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        const [anchor] = collectAnchors(change.content)
        expect(anchor).to.include({
          kind: 'comment',
          quote: 'Lake Tahoe',
          insertion: 'Donner Lake',
        })
        expect(docToPlainText(change.content)).to.equal('I went to Lake TahoeDonner Lake with Dad')
      })
      cy.findByText('Add wording…').should('not.exist')
    })

    it('pairs a strike with replacement wording under one anchor id', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(10, 20)
      cy.findByRole('button', { name: 'Strike passage' }).click()
      cy.focused().type('Donner Lake')

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ kind: 'strike', quote: 'Lake Tahoe', insertion: 'Donner Lake' })
      })
    })

    it('places a bare insertion at the caret when nothing is selected', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(0, 0)
      cy.focused().type('perhaps')

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ kind: null, insertion: 'perhaps' })
      })
    })

    it('takes a list marker typed at a line’s start as wording', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(0, 0)
      cy.focused().type('- ')

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ kind: null, insertion: '- ' })
      })
    })

    it('types wording plain, without the formatting of the text before it', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(
        onChange,
        serializeDocument({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'I went with ' },
                { type: 'text', text: 'Dad', marks: [{ type: 'bold' }] },
              ],
            },
          ],
        }),
      )

      select(15, 15)
      cy.focused().type('!')

      cy.get('@change').then((stub) => {
        const typed = JSON.parse(lastChange(stub).content).content[0].content[2]
        expect(typed.text).to.equal('!')
        expect(typed.marks.map((mark: { type: string }) => mark.type)).to.deep.equal([
          'anchorWording',
        ])
      })
    })

    it('takes a paste as wording typed on one line, and reports it as a paste', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(0, 0)
      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
        paste($editor[0]!, { 'text/plain': 'Last\nsummer, ' }),
      )

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        const [anchor] = collectAnchors(change.content)
        expect(anchor).to.include({ kind: null, insertion: 'Last summer, ' })
        expect(change.is_paste).to.equal(true)
      })
    })

    it('ignores dropped text', () => {
      const onChange = cy.stub()
      mountAnchorEditor(onChange)

      cy.findByRole('textbox', { name: 'New entry' }).then(($editor) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.setData('text/plain', 'Donner Lake')
        const { left, top } = $editor[0]!.querySelector('p')!.getBoundingClientRect()

        // Neither runner has a first-class drop, so a hand-built one goes at the first line's start.
        $editor[0]!.dispatchEvent(
          new DragEvent('drop', { dataTransfer, clientX: left + 1, clientY: top + 1 }),
        )

        // A drop is handled as it's dispatched, so a change it made would already be reported.
        expect(onChange.callCount).to.equal(0)
      })
    })

    it('removes a bare insertion from the menu at its caret', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(0, 0)
      cy.focused().type('perhaps')
      cy.findByRole('button', { name: 'Remove anchor' }).click()

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(collectAnchors(change.content)).to.deep.equal([])
        expect(docToPlainText(change.content)).to.equal('I went to Lake Tahoe with Dad')
      })
    })

    it('trims whitespace off a selection’s edges before anchoring it', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      // " Lake Tahoe " (9-21) carries a space on both sides of the word "Lake Tahoe" (10-20).
      select(9, 21)
      cy.findByRole('button', { name: 'Highlight passage' }).click()

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ quote: 'Lake Tahoe', kind: 'comment' })
      })
    })

    it('places a highlight and its wording through the keyboard alone', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(10, 20)
      cy.focused().type('{ctrl+alt+h}Donner Lake')

      cy.get('@change').then((stub) => {
        const [anchor] = collectAnchors(lastChange(stub).content)
        expect(anchor).to.include({ kind: 'comment', insertion: 'Donner Lake' })
      })
    })

    it('does not let wording typed after a sealed anchor join it', () => {
      const onChange = cy.stub().as('change')
      // "sealed-1" stands for an anchor an earlier related entry already placed and sealed — present in
      // the document this editor opened with, not something this session placed.
      mountAnchorEditor(
        onChange,
        withAnchorMark('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20),
      )

      select(20, 20)
      cy.focused().type('!')

      cy.get('@change').then((stub) => {
        const anchors = collectAnchors(lastChange(stub).content)
        expect(anchors).to.have.length(2)
        expect(anchors.find((anchor) => anchor.anchor_id === 'sealed-1')).to.include({
          insertion: null,
        })
        const bare = anchors.find((anchor) => anchor.anchor_id !== 'sealed-1')
        expect(bare).to.include({ kind: null, insertion: '!' })
      })
    })

    it('leaves a sealed anchor alone: typing in its passage or its wording does nothing', () => {
      const onChange = cy.stub().as('change')
      // "Lake Tahoe" is 10-20 and its wording "Donner Lake" 20-31.
      mountAnchorEditor(
        onChange,
        withAnchorWording('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20, 'Donner Lake'),
      )

      select(12, 12)
      cy.focused().type('x')
      select(25, 25)
      cy.focused().type('x')
      // Typing that goes through, after the refused keystrokes.
      select(40, 40)
      cy.focused().type('!')

      cy.get('@change').then((stub) => {
        const anchors = collectAnchors(lastChange(stub).content)
        expect(anchors).to.have.length(2)
        expect(anchors[0]).to.include({
          anchor_id: 'sealed-1',
          quote: 'Lake Tahoe',
          insertion: 'Donner Lake',
        })
        expect(anchors[1]).to.include({ kind: null, insertion: '!' })
      })
    })

    it('drops an anchor back out on Undo', () => {
      const onChange = cy.stub().as('change')
      mountAnchorEditor(onChange)

      select(10, 20)
      cy.findByRole('button', { name: 'Highlight passage' }).click()
      cy.get('@change').then((stub) =>
        expect(collectAnchors(lastChange(stub).content)).to.have.length(1),
      )

      cy.findByRole('button', { name: 'Undo' }).click()

      cy.get('@change').then((stub) => {
        const change = lastChange(stub)
        expect(collectAnchors(change.content)).to.deep.equal([])
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

      select(10, 20)
      cy.findByRole('button', { name: 'Highlight passage' }).click()
      cy.focused().type('Donner Lake{ctrl+alt+s}')
      select(0, 0)
      cy.focused().type('perhaps')
      cy.focused().type('{ctrl+z}')

      cy.get('@change').then((stub) => {
        expect(replayAll(base, stub)).to.deep.equal([JSON.parse(lastChange(stub).content)])
      })
    })

    describe('editing an anchor already placed this session', () => {
      /** Places a highlight over "Lake Tahoe" and types "Donner Lake" as its wording. */
      function placeHighlightWithWording() {
        select(10, 20)
        cy.findByRole('button', { name: 'Highlight passage' }).click()
        cy.focused().type('Donner Lake')
      }

      it('returns to the end of a placed anchor’s wording when its passage is clicked', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()
        select(0, 0)

        cy.findByText('Lake Tahoe').click()
        cy.focused().type('{backspace}')

        cy.get('@change').then((stub) => {
          const [anchor] = collectAnchors(lastChange(stub).content)
          expect(anchor).to.include({ quote: 'Lake Tahoe', insertion: 'Donner Lak' })
        })
      })

      it('puts the caret where its wording is clicked', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()
        select(0, 0)

        // The wording's left edge, before its first letter. A real click, since Cypress's own moves
        // the selection to the clicked element's end.
        cy.findByText('Donner Lake').realClick({ x: 1, y: 5 })
        cy.focused().type('!')

        cy.get('@change').then((stub) => {
          const [anchor] = collectAnchors(lastChange(stub).content)
          expect(anchor).to.include({ quote: 'Lake Tahoe', insertion: '!Donner Lake' })
        })
      })

      it('puts typing on its passage at the end of its wording', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        select(12, 12)
        cy.focused().type('!')

        cy.get('@change').then((stub) => {
          const [anchor] = collectAnchors(lastChange(stub).content)
          expect(anchor).to.include({ quote: 'Lake Tahoe', insertion: 'Donner Lake!' })
        })
      })

      it('puts a paste on its passage at the end of its wording, as typing', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        select(12, 12)
        cy.findByRole('textbox', { name: 'New entry' }).then(($editor) =>
          paste($editor[0]!, { 'text/plain': '!' }),
        )

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          const [anchor] = collectAnchors(change.content)
          expect(anchor).to.include({ quote: 'Lake Tahoe', insertion: 'Donner Lake!' })
          expect(change.is_paste).to.equal(true)
        })
      })

      it('reports a keystroke in its wording as ordinary text entry', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        cy.focused().type('.')

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          // What the mark policy's punctuation check reads — see `changeSignals`.
          expect(change.inserted_text).to.equal('.')
          expect(change.is_anchor_op).to.equal(false)
          expect(change.is_formatting).to.equal(false)
        })
      })

      it('switches a placed anchor’s kind from the menu at its caret', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()

        cy.findByRole('button', { name: 'Strike passage' }).click()

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          const [anchor] = collectAnchors(change.content)
          expect(anchor).to.include({ kind: 'strike', insertion: 'Donner Lake' })
          expect(change.is_anchor_op).to.equal(true)
        })
      })

      it('removes a placed anchor and its wording from the menu at its caret', () => {
        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange)
        placeHighlightWithWording()
        cy.get('@change').then((stub) => {
          const anchors = collectAnchors(lastChange(stub).content)
          expect(anchors).to.have.length(1)
          expect(anchors[0]).to.include({ quote: 'Lake Tahoe', insertion: 'Donner Lake' })
        })

        cy.findByRole('button', { name: 'Remove anchor' }).click()

        cy.get('@change').then((stub) => {
          const change = lastChange(stub)
          expect(collectAnchors(change.content)).to.deep.equal([])
          expect(change.is_anchor_op).to.equal(true)
          // The passage stays, as the parent's text; only its wording is deleted.
          expect(docToPlainText(change.content)).to.equal('I went to Lake Tahoe with Dad')
          expect(change.removed_chars).to.equal('Donner Lake'.length)
        })
      })

      for (const [how, from, to] of [
        ['selected exactly', 10, 20],
        ['overlapped at all', 15, 25],
      ] as const) {
        it(`returns to a placed anchor ${how}, rather than changing its kind or placing a second`, () => {
          const onChange = cy.stub().as('change')
          mountAnchorEditor(onChange)
          placeHighlightWithWording()

          select(from, to)
          cy.findByRole('button', { name: 'Strike passage' }).click()
          cy.focused().type('!')

          cy.get('@change').then((stub) => {
            const anchors = collectAnchors(lastChange(stub).content)
            expect(anchors).to.have.length(1)
            expect(anchors[0]).to.include({ kind: 'comment', insertion: 'Donner Lake!' })
          })
        })
      }

      it('lets a resumed session keep editing an anchor it placed before the resume', () => {
        // Stands for a draft resumed after a reload: "resumed-1" was placed and persisted before
        // the reload, so it's already in the document this editor mounts with.
        const base = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad'))
        const seeded = withAnchorWording(
          'I went to Lake Tahoe with Dad',
          'resumed-1',
          10,
          20,
          'Donner Lake',
        )
        // The base — the parent as the session first found it, the version
        // `Draft.parent.base_version_id` names — is what still tells it apart from an anchor an
        // earlier related entry sealed.
        expect(anchorsPlacedSince(base, seeded)).to.deep.equal(['resumed-1'])

        const onChange = cy.stub().as('change')
        mountAnchorEditor(onChange, seeded, { anchorBaseContent: base })

        cy.findByText('Lake Tahoe').click()
        cy.focused().type('!')

        cy.findByRole('textbox', { name: 'New entry' }).should(
          'contain.text',
          'Donner Lake! with Dad',
        )
        cy.get('@change').then((stub) => {
          const [anchor] = collectAnchors(lastChange(stub).content)
          expect(anchor).to.include({ anchor_id: 'resumed-1', insertion: 'Donner Lake!' })
        })
      })
    })
  })
})
