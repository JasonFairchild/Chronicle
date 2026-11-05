import { Editor } from '@tiptap/vue-3'

import EditorToolbar from '@/components/EditorToolbar.vue'
import { collectAnchors } from '@/domain/anchors'
import {
  ANCHOR_MARK,
  ANCHOR_WORDING_MARK,
  collectMediaRefs,
  docToPlainText,
  type EntryDocument,
} from '@/domain/entryDocument'
import { entryExtensions } from '@/editor/extensions'
import { mediaRepository } from '@/repositories'
import { plainTextDocument } from '@/testing/documents'
import { selectTextRange } from '@/testing/selectTextRange'

/** A paragraph whose text from `from` to `to` carries `mark`. */
function markedDocument(
  text: string,
  from: number,
  to: number,
  mark: { type: string; attrs?: Record<string, unknown> },
): EntryDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: text.slice(0, from) },
          { type: 'text', text: text.slice(from, to), marks: [mark] },
          { type: 'text', text: text.slice(to) },
        ].filter((node) => node.text !== ''),
      },
    ],
  }
}

describe('EditorToolbar', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  /**
   * The toolbar over an editor attached after it, as `DocumentEditor` lays them out, with a Title
   * field before it to Tab from, as `EntryComposer` has.
   */
  function mountToolbar(content: EntryDocument = plainTextDocument(''), disabled = false): Editor {
    const element = document.createElement('div')
    const editor = new Editor({
      element,
      extensions: entryExtensions(),
      content,
      editorProps: { attributes: { role: 'textbox', 'aria-label': 'New entry' } },
    })
    const title = document.createElement('input')
    title.setAttribute('aria-label', 'Title')
    cleanup = () => {
      editor.destroy()
      element.remove()
      title.remove()
    }

    cy.mount(EditorToolbar, { props: { editor, label: 'New entry', disabled } }).then(() => {
      document.body.prepend(title)
      document.body.append(element)
    })
    return editor
  }

  it('is one Tab stop, on its first enabled control', () => {
    mountToolbar()

    cy.findByRole('textbox', { name: 'Title' }).click()
    cy.press(Cypress.Keyboard.Keys.TAB)
    // Undo and Redo come first, disabled with nothing to undo.
    cy.findByRole('combobox', { name: 'Text style' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.findByRole('textbox', { name: 'New entry' }).should('have.focus')
  })

  it('moves between its controls on the arrow keys, Home and End, past disabled ones', () => {
    mountToolbar()

    cy.findByRole('textbox', { name: 'Title' }).click()
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.press(Cypress.Keyboard.Keys.LEFT)
    cy.findByRole('button', { name: 'More formatting actions' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.RIGHT)
    cy.findByRole('combobox', { name: 'Text style' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.RIGHT)
    cy.findByRole('button', { name: 'Bold' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.END)
    cy.findByRole('button', { name: 'More formatting actions' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.HOME)
    // Arrowed onto and off of, never changed.
    cy.findByRole('combobox', { name: 'Text style' })
      .should('have.focus')
      .and('have.value', 'paragraph')
  })

  it('keeps the Tab stop on the control last reached', () => {
    mountToolbar()

    cy.findByRole('textbox', { name: 'Title' }).click()
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.press(Cypress.Keyboard.Keys.RIGHT)
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.findByRole('textbox', { name: 'Title' }).click()
    cy.press(Cypress.Keyboard.Keys.TAB)

    cy.findByRole('button', { name: 'Bold' }).should('have.focus')
  })

  it('shows a toggle pressed while the selection carries its mark, and applies it on a click', () => {
    const editor = mountToolbar(markedDocument('Worth remembering', 0, 5, { type: 'bold' }))

    cy.findByRole('textbox', { name: 'New entry' })
      .focus()
      .then(($body) => selectTextRange($body[0]!, 1, 3))
    cy.findByRole('button', { name: 'Bold' }).should('have.attr', 'aria-pressed', 'true')
    cy.findByRole('textbox', { name: 'New entry' }).then(($body) =>
      selectTextRange($body[0]!, 6, 17),
    )
    cy.findByRole('button', { name: 'Bold' }).should('have.attr', 'aria-pressed', 'false')

    cy.findByRole('button', { name: 'Bold' }).click()

    cy.wrap(editor)
      .invoke('getHTML')
      .should('equal', '<p><strong>Worth</strong> <strong>remembering</strong></p>')
  })

  it('disables undo and redo until there is something to undo', () => {
    mountToolbar()

    cy.findByRole('button', { name: 'Undo' }).should('be.disabled')
    cy.findByRole('button', { name: 'Redo' }).should('be.disabled')

    cy.findByRole('textbox', { name: 'New entry' }).type('Lake Tahoe')
    cy.findByRole('button', { name: 'Undo' }).should('be.enabled')
  })

  it('shows the block type at the caret, and sets it', () => {
    const editor = mountToolbar({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lake Tahoe' }] },
      ],
    })

    // A new editor's caret starts at the top, in the heading.
    cy.findByRole('combobox', { name: 'Text style' }).should('have.value', 'heading')

    cy.findByRole('combobox', { name: 'Text style' }).select('Normal text')

    cy.wrap(editor).invoke('getHTML').should('equal', '<p>Lake Tahoe</p>')
    cy.findByRole('combobox', { name: 'Text style' }).should('have.value', 'paragraph')
  })

  it('opens Link on the address under the caret, and applies a new one to the whole link', () => {
    mountToolbar(
      markedDocument('The trail report', 4, 16, {
        type: 'link',
        attrs: { href: 'https://example.com/old' },
      }),
    )
    cy.findByRole('textbox', { name: 'New entry' })
      .focus()
      .then(($body) => selectTextRange($body[0]!, 8, 8))

    cy.findByRole('button', { name: 'Link' }).click()
    cy.findByLabelText('Link address').should('have.value', 'https://example.com/old')
    cy.findByLabelText('Link address').clear()
    cy.findByLabelText('Link address').type('https://example.com/trail')
    cy.findByRole('button', { name: 'Apply link' }).click()

    cy.findByRole('link', { name: 'trail report' }).should(
      'have.attr',
      'href',
      'https://example.com/trail',
    )
  })

  it('closes More on Escape, with focus back on its toggle', () => {
    mountToolbar()

    cy.findByRole('textbox', { name: 'Title' }).click()
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.press(Cypress.Keyboard.Keys.END)
    // `cy.press` sends Enter without the keypress that activates a button.
    cy.findByRole('button', { name: 'More formatting actions' }).should('have.focus').click()
    cy.findByRole('button', { name: 'Clear formatting' }).should('be.visible')
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.press(Cypress.Keyboard.Keys.ESC)

    cy.findByRole('button', { name: 'More formatting actions' })
      .should('have.attr', 'aria-expanded', 'false')
      .and('have.focus')
  })

  it('clears formatting but leaves an anchor and its wording', () => {
    // The guard would refuse the whole clear had it changed the anchor, so the bold beside it
    // going shows the anchor's marks were never touched.
    const editor = mountToolbar({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'It ' },
            {
              type: 'text',
              text: 'rained',
              marks: [{ type: ANCHOR_MARK, attrs: { anchorId: 'anchor-1', kind: 'comment' } }],
            },
            {
              type: 'text',
              text: 'heavily',
              marks: [{ type: ANCHOR_WORDING_MARK, attrs: { anchorId: 'anchor-1' } }],
            },
            { type: 'text', text: ' all day', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })
    cy.findByRole('textbox', { name: 'New entry' })
      .focus()
      .then(($body) => selectTextRange($body[0]!, 0, 24))

    cy.findByRole('button', { name: 'More formatting actions' }).click()
    cy.findByRole('button', { name: 'Clear formatting' }).click()

    cy.wrap(editor).invoke('getHTML').should('not.contain', '<strong>')
    cy.wrap(editor)
      .invoke('getJSON')
      .then((document) => {
        expect(collectAnchors(document as EntryDocument)).to.deep.equal([
          { anchor_id: 'anchor-1', kind: 'comment', quote: 'rained', insertion: 'heavily' },
        ])
      })
  })

  it('disables every control while `disabled`', () => {
    mountToolbar(plainTextDocument(''), true)

    cy.findAllByRole('button')
      .should('have.length', 11)
      .each(($button) => {
        cy.wrap($button).should('be.disabled')
      })
    cy.findByRole('combobox', { name: 'Text style' }).should('be.disabled')
  })

  it('stores an attached image and inserts it into the document by id', () => {
    const editor = mountToolbar()

    // Forced because the input is hidden behind Add image.
    cy.findByTestId('image-file-input').selectFile(
      {
        contents: Cypress.Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        fileName: 'lake.png',
        mimeType: 'image/png',
      },
      { force: true },
    )

    cy.wrap(editor)
      .should((instance) =>
        expect(collectMediaRefs(instance.getJSON() as EntryDocument)).to.have.length(1),
      )
      // Read back because storing is this toolbar's own output (TESTING.md, "Layers").
      .then((instance) =>
        mediaRepository.get(collectMediaRefs(instance.getJSON() as EntryDocument)[0]!),
      )
      .should('not.be.null')
  })

  it('leaves the caret in the document after a click, so typing carries on', () => {
    const editor = mountToolbar()

    cy.findByRole('textbox', { name: 'New entry' }).type('Worth remembering')
    cy.findByRole('button', { name: 'Quote' }).click()
    cy.focused().type(', and worth keeping')

    // Trimmed because the quote's block ends in a line break.
    cy.wrap(editor).should((instance) =>
      expect(docToPlainText(instance.getJSON() as EntryDocument).trim()).to.equal(
        'Worth remembering, and worth keeping',
      ),
    )
  })
})
