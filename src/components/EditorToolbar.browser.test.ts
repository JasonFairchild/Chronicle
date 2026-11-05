import { Editor } from '@tiptap/vue-3'
import { describe, expect, it, onTestFinished } from 'vitest'
import { userEvent } from 'vitest/browser'

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
import { renderComponent } from '@/testing/renderComponent'
import { selectTextRange } from '@/testing/selectTextRange'

function pngFile(): File {
  return new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'lake.png', { type: 'image/png' })
}

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

describe('EditorToolbar (browser)', () => {
  /**
   * The toolbar over an editor attached after it, as `DocumentEditor` lays them out, with a Title
   * field before it to Tab from, as `EntryComposer` has.
   */
  function mountToolbar(content: EntryDocument = plainTextDocument(''), disabled = false) {
    const element = document.createElement('div')
    const editor = new Editor({
      element,
      extensions: entryExtensions(),
      content,
      editorProps: { attributes: { role: 'textbox', 'aria-label': 'New entry' } },
    })
    const title = document.createElement('input')
    title.setAttribute('aria-label', 'Title')
    onTestFinished(() => {
      editor.destroy()
      element.remove()
      title.remove()
    })

    const screen = renderComponent(EditorToolbar, {
      props: { editor, label: 'New entry', disabled },
    })
    document.body.prepend(title)
    document.body.append(element)
    return { screen, editor }
  }

  it('is one Tab stop, on its first enabled control', async () => {
    const { screen } = mountToolbar()

    await screen.getByRole('textbox', { name: 'Title' }).click()
    await userEvent.keyboard('{Tab}')
    // Undo and Redo come first, disabled with nothing to undo.
    await expect.element(screen.getByRole('combobox', { name: 'Text style' })).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect.element(screen.getByRole('textbox', { name: 'New entry' })).toHaveFocus()
  })

  it('moves between its controls on the arrow keys, Home and End, past disabled ones', async () => {
    const { screen } = mountToolbar()
    const textStyle = screen.getByRole('combobox', { name: 'Text style' })
    const more = screen.getByRole('button', { name: 'More formatting actions' })

    await screen.getByRole('textbox', { name: 'Title' }).click()
    await userEvent.keyboard('{Tab}{ArrowLeft}')
    await expect.element(more).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(textStyle).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(screen.getByRole('button', { name: 'Bold' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect.element(more).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect.element(textStyle).toHaveFocus()
    // Arrowed onto and off of, never changed.
    await expect.element(textStyle).toHaveValue('paragraph')
  })

  it('keeps the Tab stop on the control last reached', async () => {
    const { screen } = mountToolbar()
    const title = screen.getByRole('textbox', { name: 'Title' })

    await title.click()
    await userEvent.keyboard('{Tab}{ArrowRight}{Tab}')
    await title.click()
    await userEvent.keyboard('{Tab}')

    await expect.element(screen.getByRole('button', { name: 'Bold' })).toHaveFocus()
  })

  it('shows a toggle pressed while the selection carries its mark, and applies it on a click', async () => {
    const { screen, editor } = mountToolbar(
      markedDocument('Worth remembering', 0, 5, { type: 'bold' }),
    )
    const body = screen.getByRole('textbox', { name: 'New entry' })
    const bold = screen.getByRole('button', { name: 'Bold' })
    body.element().focus()

    selectTextRange(body.element(), 1, 3)
    await expect.element(bold).toHaveAttribute('aria-pressed', 'true')
    selectTextRange(body.element(), 6, 17)
    await expect.element(bold).toHaveAttribute('aria-pressed', 'false')

    await bold.click()

    expect(editor.getHTML()).toBe('<p><strong>Worth</strong> <strong>remembering</strong></p>')
  })

  it('disables undo and redo until there is something to undo', async () => {
    const { screen } = mountToolbar()
    const undo = screen.getByRole('button', { name: 'Undo' })

    await expect.element(undo).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Lake Tahoe')
    await expect.element(undo).toBeEnabled()
  })

  it('shows the block type at the caret, and sets it', async () => {
    const { screen, editor } = mountToolbar({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lake Tahoe' }] },
      ],
    })
    const textStyle = screen.getByRole('combobox', { name: 'Text style' })

    // A new editor's caret starts at the top, in the heading.
    await expect.element(textStyle).toHaveValue('heading')

    await textStyle.selectOptions('Normal text')

    expect(editor.getHTML()).toBe('<p>Lake Tahoe</p>')
    await expect.element(textStyle).toHaveValue('paragraph')
  })

  it('opens Link on the address under the caret, and applies a new one to the whole link', async () => {
    const { screen } = mountToolbar(
      markedDocument('The trail report', 4, 16, {
        type: 'link',
        attrs: { href: 'https://example.com/old' },
      }),
    )
    const body = screen.getByRole('textbox', { name: 'New entry' })
    body.element().focus()
    selectTextRange(body.element(), 8, 8)

    await screen.getByRole('button', { name: 'Link' }).click()
    const address = screen.getByLabelText('Link address')
    await expect.element(address).toHaveValue('https://example.com/old')
    await address.fill('https://example.com/trail')
    await screen.getByRole('button', { name: 'Apply link' }).click()

    await expect
      .element(screen.getByRole('link', { name: 'trail report' }))
      .toHaveAttribute('href', 'https://example.com/trail')
  })

  it('closes More on Escape, with focus back on its toggle', async () => {
    const { screen } = mountToolbar()
    const more = screen.getByRole('button', { name: 'More formatting actions' })

    await screen.getByRole('textbox', { name: 'Title' }).click()
    await userEvent.keyboard('{Tab}{End}{Enter}')
    await expect.element(screen.getByRole('button', { name: 'Clear formatting' })).toBeVisible()
    await userEvent.keyboard('{Tab}{Escape}')

    await expect.element(more).toHaveAttribute('aria-expanded', 'false')
    await expect.element(more).toHaveFocus()
  })

  it('clears formatting but leaves an anchor and its wording', async () => {
    // The guard would refuse the whole clear had it changed the anchor, so the bold beside it
    // going shows the anchor's marks were never touched.
    const { screen, editor } = mountToolbar({
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
    const body = screen.getByRole('textbox', { name: 'New entry' })
    body.element().focus()
    selectTextRange(body.element(), 0, 24)

    await screen.getByRole('button', { name: 'More formatting actions' }).click()
    await screen.getByRole('button', { name: 'Clear formatting' }).click()

    expect(editor.getHTML()).not.toContain('<strong>')
    expect(collectAnchors(editor.getJSON() as EntryDocument)).toEqual([
      { anchor_id: 'anchor-1', kind: 'comment', quote: 'rained', insertion: 'heavily' },
    ])
  })

  it('disables every control while `disabled`', async () => {
    const { screen } = mountToolbar(plainTextDocument(''), true)
    const buttons = screen.getByRole('button').all()

    expect(buttons).toHaveLength(11)
    for (const button of buttons) await expect.element(button).toBeDisabled()
    await expect.element(screen.getByRole('combobox', { name: 'Text style' })).toBeDisabled()
  })

  it('stores an attached image and inserts it into the document by id', async () => {
    const { screen, editor } = mountToolbar()

    await screen.getByTestId('image-file-input').upload(pngFile())

    await expect.poll(() => collectMediaRefs(editor.getJSON() as EntryDocument)).toHaveLength(1)
    const [mediaRef] = collectMediaRefs(editor.getJSON() as EntryDocument)
    // Read back because storing is this toolbar's own output (TESTING.md, "Layers").
    expect(await mediaRepository.get(mediaRef!)).not.toBeNull()
  })

  it('leaves the caret in the document after a click, so typing carries on', async () => {
    const { screen, editor } = mountToolbar()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await screen.getByRole('button', { name: 'Quote' }).click()
    await userEvent.keyboard(', and worth keeping')

    // Trimmed because the quote's block ends in a line break.
    expect(docToPlainText(editor.getJSON() as EntryDocument).trim()).toBe(
      'Worth remembering, and worth keeping',
    )
  })
})
