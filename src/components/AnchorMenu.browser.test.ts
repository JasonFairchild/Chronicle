import { Editor } from '@tiptap/vue-3'
import { describe, expect, it, onTestFinished } from 'vitest'
import { userEvent } from 'vitest/browser'

import AnchorMenu from '@/components/AnchorMenu.vue'
import { collectAnchors } from '@/domain/anchors'
import { docToPlainText, type EntryDocument } from '@/domain/entryDocument'
import { entryExtensions } from '@/editor/extensions'
import { withAnchorWording } from '@/testing/anchorFixtures'
import { plainTextDocument, serializeDocument } from '@/testing/documents'
import { renderComponent } from '@/testing/renderComponent'
import { selectTextRange } from '@/testing/selectTextRange'

const TEXT = 'I went to Lake Tahoe with Dad'

describe('AnchorMenu (browser)', () => {
  /**
   * The menu over an anchor-mode editor whose session began from `base`, so anchors in `content`
   * that `base` lacks are the session's own.
   */
  function mountMenu(content: string, base = serializeDocument(plainTextDocument(TEXT))) {
    const element = document.createElement('div')
    const editor = new Editor({
      element,
      extensions: entryExtensions({ anchorMode: true, baseContent: base }),
      content: JSON.parse(content) as EntryDocument,
      editorProps: { attributes: { role: 'textbox', 'aria-label': 'Entry being annotated' } },
    })
    onTestFinished(() => {
      editor.destroy()
      element.remove()
    })

    const screen = renderComponent(AnchorMenu, { props: { editor } })
    document.body.append(element)
    const body = screen.getByRole('textbox', { name: 'Entry being annotated' })
    body.element().focus()
    return { screen, editor, body }
  }

  function anchorsOf(editor: Editor) {
    return collectAnchors(editor.getJSON() as EntryDocument)
  }

  it('offers Highlight and Strike over a selection, and marks it', async () => {
    const { screen, editor, body } = mountMenu(JSON.stringify(plainTextDocument(TEXT)))

    selectTextRange(body.element(), 10, 20)
    const highlight = screen.getByRole('button', { name: 'Highlight passage' })
    await expect.element(highlight).not.toHaveAttribute('aria-pressed')
    await expect.element(screen.getByRole('button', { name: 'Strike passage' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove anchor' }).query()).toBeNull()

    await highlight.click()

    expect(anchorsOf(editor)).toMatchObject([{ kind: 'comment', quote: 'Lake Tahoe' }])
  })

  it('shows the kind of the session’s anchor at the caret pressed, and switches it', async () => {
    // "Lake Tahoe" is 10-20 and its wording "Donner Lake" 20-31.
    const { screen, editor, body } = mountMenu(
      withAnchorWording(TEXT, 'anchor-1', 10, 20, 'Donner Lake'),
    )
    const strike = screen.getByRole('button', { name: 'Strike passage' })

    selectTextRange(body.element(), 25, 25)
    await expect
      .element(screen.getByRole('button', { name: 'Highlight passage' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect.element(strike).toHaveAttribute('aria-pressed', 'false')

    await strike.click()

    expect(anchorsOf(editor)).toMatchObject([{ kind: 'strike', insertion: 'Donner Lake' }])
    await expect.element(strike).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes the session’s anchor at the caret, passage mark and wording', async () => {
    const { screen, editor, body } = mountMenu(
      withAnchorWording(TEXT, 'anchor-1', 10, 20, 'Donner Lake'),
    )

    selectTextRange(body.element(), 25, 25)
    await screen.getByRole('button', { name: 'Remove anchor' }).click()

    expect(anchorsOf(editor)).toEqual([])
    expect(docToPlainText(editor.getJSON() as EntryDocument)).toBe(TEXT)
  })

  it('offers only Remove for a bare insertion at the caret', async () => {
    // "perhaps" is 10-17, with no passage.
    const { screen, body } = mountMenu(withAnchorWording(TEXT, 'anchor-1', 10, 10, 'perhaps'))

    selectTextRange(body.element(), 13, 13)

    await expect.element(screen.getByRole('button', { name: 'Remove anchor' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Highlight passage' }).query()).toBeNull()
  })

  it('shows nothing at the caret on a sealed anchor', async () => {
    const content = withAnchorWording(TEXT, 'sealed-1', 10, 20, 'Donner Lake')
    const { screen, body } = mountMenu(content, content)
    const highlight = screen.getByRole('button', { name: 'Highlight passage' })

    selectTextRange(body.element(), 0, 5)
    await expect.element(highlight).toBeVisible()
    selectTextRange(body.element(), 25, 25)

    await expect.element(highlight).not.toBeInTheDocument()
  })

  it('takes Tab from the document to its first button, and on through the rest', async () => {
    const { screen, body } = mountMenu(withAnchorWording(TEXT, 'anchor-1', 10, 20, 'Donner Lake'))
    const highlight = screen.getByRole('button', { name: 'Highlight passage' })
    const remove = screen.getByRole('button', { name: 'Remove anchor' })

    selectTextRange(body.element(), 25, 25)
    // `@tiptap/vue-3` hands the menu a new state two animation frames late, and Highlight shows
    // before that, so only Remove says the menu is ready to Tab through.
    await expect.element(remove).toBeVisible()
    await userEvent.keyboard('{Tab}')
    await expect.element(highlight).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect.element(screen.getByRole('button', { name: 'Strike passage' })).toHaveFocus()
    await userEvent.keyboard('{Tab}')

    await expect.element(remove).toHaveFocus()
  })
})
