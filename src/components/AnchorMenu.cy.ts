import { Editor } from '@tiptap/vue-3'

import AnchorMenu from '@/components/AnchorMenu.vue'
import { collectAnchors } from '@/domain/anchors'
import { docToPlainText, type EntryDocument } from '@/domain/entryDocument'
import { entryExtensions } from '@/editor/extensions'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { plainTextDocument } from '@/testing/documents'
import { selectTextRange } from '@/testing/selectTextRange'

const TEXT = 'I went to Lake Tahoe with Dad'

describe('AnchorMenu', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  /**
   * The menu over an anchor-mode editor whose session began from `base`, so anchors in `content`
   * that `base` lacks are the session's own.
   */
  function mountMenu(content: string, base: EntryDocument = plainTextDocument(TEXT)): Editor {
    const element = document.createElement('div')
    const editor = new Editor({
      element,
      extensions: entryExtensions({ anchorMode: true, baseContent: base }),
      content: JSON.parse(content) as EntryDocument,
      editorProps: { attributes: { role: 'textbox', 'aria-label': 'Entry being annotated' } },
    })
    cleanup = () => {
      editor.destroy()
      element.remove()
    }

    cy.mount(AnchorMenu, { props: { editor } }).then(() => document.body.append(element))
    return editor
  }

  function select(from: number, to: number) {
    cy.findByRole('textbox', { name: 'Entry being annotated' }).then(($editor) => {
      $editor[0]!.focus()
      selectTextRange($editor[0]!, from, to)
    })
  }

  function anchorsOf(editor: Editor) {
    return collectAnchors(editor.getJSON() as EntryDocument)
  }

  it('offers Highlight and Strike over a selection, and marks it', () => {
    const editor = mountMenu(JSON.stringify(plainTextDocument(TEXT)))

    select(10, 20)
    cy.findByRole('button', { name: 'Highlight passage' }).should('not.have.attr', 'aria-pressed')
    cy.findByRole('button', { name: 'Strike passage' }).should('be.visible')
    cy.findByRole('button', { name: 'Remove anchor' }).should('not.exist')

    cy.findByRole('button', { name: 'Highlight passage' }).click()

    cy.then(() => {
      const anchors = anchorsOf(editor)
      expect(anchors).to.have.length(1)
      expect(anchors[0]).to.include({ kind: 'comment', quote: 'Lake Tahoe' })
    })
  })

  it('shows the kind of the session’s anchor at the caret pressed, and switches it', () => {
    // "Lake Tahoe" is 10-20 and its wording "Donner Lake" 20-31.
    const editor = mountMenu(withAnchorWording(TEXT, 'anchor-1', 10, 20, 'Donner Lake'))

    select(25, 25)
    cy.findByRole('button', { name: 'Highlight passage' }).should(
      'have.attr',
      'aria-pressed',
      'true',
    )
    cy.findByRole('button', { name: 'Strike passage' }).should('have.attr', 'aria-pressed', 'false')

    cy.findByRole('button', { name: 'Strike passage' }).click()

    cy.then(() => {
      const anchors = anchorsOf(editor)
      expect(anchors).to.have.length(1)
      expect(anchors[0]).to.include({ kind: 'strike', insertion: 'Donner Lake' })
    })
    cy.findByRole('button', { name: 'Strike passage' }).should('have.attr', 'aria-pressed', 'true')
  })

  it('removes the session’s anchor at the caret, passage mark and wording', () => {
    const editor = mountMenu(withAnchorWording(TEXT, 'anchor-1', 10, 20, 'Donner Lake'))

    select(25, 25)
    cy.findByRole('button', { name: 'Remove anchor' }).click()

    cy.then(() => {
      expect(anchorsOf(editor)).to.deep.equal([])
      expect(docToPlainText(editor.getJSON() as EntryDocument)).to.equal(TEXT)
    })
  })

  it('offers only Remove for a bare insertion at the caret', () => {
    // "perhaps" is 10-17, with no passage.
    mountMenu(withAnchorWording(TEXT, 'anchor-1', 10, 10, 'perhaps'))

    select(13, 13)

    cy.findByRole('button', { name: 'Remove anchor' }).should('be.visible')
    cy.findByRole('button', { name: 'Highlight passage' }).should('not.exist')
  })

  it('shows nothing at the caret on a sealed anchor', () => {
    const content = withAnchorWording(TEXT, 'sealed-1', 10, 20, 'Donner Lake')
    mountMenu(content, JSON.parse(content) as EntryDocument)

    select(0, 5)
    cy.findByRole('button', { name: 'Highlight passage' }).should('be.visible')
    select(25, 25)

    cy.findByRole('button', { name: 'Highlight passage' }).should('not.exist')
  })

  it('takes Tab from the document to its first button, and on through the rest', () => {
    mountMenu(withAnchorWording(TEXT, 'anchor-1', 10, 20, 'Donner Lake'))

    select(25, 25)
    // `@tiptap/vue-3` hands the menu a new state two animation frames late, and Highlight shows
    // before that, so only Remove says the menu is ready to Tab through.
    cy.findByRole('button', { name: 'Remove anchor' }).should('be.visible')
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.findByRole('button', { name: 'Highlight passage' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.TAB)
    cy.findByRole('button', { name: 'Strike passage' }).should('have.focus')
    cy.press(Cypress.Keyboard.Keys.TAB)

    cy.findByRole('button', { name: 'Remove anchor' }).should('have.focus')
  })
})
