import { beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { collectAnchors } from '@/domain/anchors'
import {
  collectMediaRefs,
  docTitle,
  docToPlainText,
  plainTextDocument,
  serializeDocument,
} from '@/domain/entryDocument'
import { mediaRepository } from '@/repositories'
import { renderComponent } from '@/testing/renderComponent'
import { freshMediaRepository } from '@/testing/realRepositories'
import { selectTextRange } from '@/testing/selectTextRange'

function pngFile(): File {
  return new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'lake.png', { type: 'image/png' })
}

describe('DocumentEditor (browser)', () => {
  let changes: EditorChange[]

  beforeEach(() => {
    changes = []
    freshMediaRepository()
  })

  function mountEditor(props: Record<string, unknown> = {}) {
    return renderComponent(DocumentEditor, {
      props: { label: 'New entry', ...props },
      attrs: {
        onChange: (change: EditorChange) => {
          changes.push(change)
        },
      },
    })
  }

  it('reports the document it holds along with the steps that produced it', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('It rained all day.')

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toBe('It rained all day.')
    expect(latest.steps.length).toBeGreaterThan(0)
    expect(latest.isFormatting).toBe(false)
  })

  it('separates a title from the body, so each ends up where it belongs', async () => {
    const screen = mountEditor({ withTitle: true })

    // Straight onto the empty title line, which the placeholder gives a height to click.
    await screen.getByRole('heading').click()
    // Enter leaves the title for the body rather than splitting the heading in two.
    await userEvent.keyboard('Lake Tahoe{Enter}We drove up on Friday.')

    const latest = changes[changes.length - 1]!
    expect(docTitle(latest.content)).toBe('Lake Tahoe')
    expect(docToPlainText(latest.content)).toBe('We drove up on Friday.')
  })

  it('survives Enter over a selection covering the title, which cannot be split', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('heading').click()
    await userEvent.keyboard('Lake Tahoe{Enter}We drove up.')
    await userEvent.keyboard('{Control>}a{/Control}{Enter}Starting over.')

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toBe('Starting over.')
  })

  it('reports a formatting change as formatting, since it inserts no words', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'Bold' }).click()

    const latest = changes[changes.length - 1]!
    expect(latest.isFormatting).toBe(true)
    expect(latest.insertedText).toBe('')
  })

  it('reports a change of block type as formatting, since it moves no words', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await userEvent.keyboard('{Control>}a{/Control}')
    // Exact, or Playwright's substring matching also finds Subheading.
    await screen.getByRole('button', { name: 'Heading', exact: true }).click()

    // A heading arrives as a replaceAround step, which no step type tells apart from an edit.
    const latest = changes[changes.length - 1]!
    expect(latest.isFormatting).toBe(true)
    // Trimmed because the editor adds an empty block after a trailing heading, which is its
    // scaffolding rather than anything the author wrote.
    expect(docToPlainText(latest.content).trim()).toBe('Worth remembering')
  })

  it('leaves the caret in the document after a toolbar click, so typing carries on', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await screen.getByRole('button', { name: 'Quote' }).click()
    await userEvent.keyboard(', and worth keeping')

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content).trim()).toBe('Worth remembering, and worth keeping')
  })

  it('reports typing a title as an edit, since a title is content', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('heading').click()
    await userEvent.keyboard('Lake Tahoe')

    expect(changes[changes.length - 1]!.isFormatting).toBe(false)
  })

  it('turns a selection into a link at the address it is given', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('The trail report')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'Link' }).click()
    await screen.getByLabelText('Link address').fill('https://example.com/trail')
    await screen.getByRole('button', { name: 'Apply link' }).click()

    await expect
      .element(screen.getByRole('link', { name: 'The trail report' }))
      .toHaveAttribute('href', 'https://example.com/trail')
    expect(changes[changes.length - 1]!.isFormatting).toBe(true)
  })

  it('reports nothing when only its editability changes', async () => {
    // Rendered directly rather than through the helper, so `rerender` knows these exact props.
    const screen = renderComponent(DocumentEditor, {
      props: { label: 'New entry', withTitle: true, disabled: true },
      attrs: {
        onChange: (change: EditorChange) => {
          changes.push(change)
        },
      },
    })

    await screen.rerender({ disabled: false })

    // Whether a document may be edited is not a change to the document. Reporting one starts a
    // writing session nobody began, which showed up as an empty draft per visit to the page.
    expect(changes).toEqual([])
  })

  it('opens an existing document where its author left it', async () => {
    const screen = mountEditor({
      withTitle: true,
      content: serializeDocument(plainTextDocument('We drove up on Friday.', 'Lake Tahoe')),
    })

    await expect.element(screen.getByRole('heading', { name: 'Lake Tahoe' })).toBeVisible()
    await expect.element(screen.getByText('We drove up on Friday.')).toBeVisible()
  })

  it('stores an attached image in the media store and refers to it by id alone', async () => {
    const screen = mountEditor()

    await screen.getByLabelText('Attach an image').upload(pngFile())
    await expect.element(screen.getByRole('img')).toBeVisible()

    const latest = changes[changes.length - 1]!
    const [mediaRef] = collectMediaRefs(latest.content)
    expect(mediaRef).toBeTruthy()
    // An attachment adds no words, but it is content all the same.
    expect(latest.isFormatting).toBe(false)
    expect(await mediaRepository.get(mediaRef!)).not.toBeNull()
    // The bytes never enter the document: an object URL is minted per page load and would be a
    // broken reference the moment this entry was read again.
    expect(latest.content).not.toContain('blob:')
    expect(latest.content).not.toContain('data:')
  })

  describe('anchor mode', () => {
    function mountAnchorEditor() {
      return mountEditor({
        anchorMode: true,
        content: serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad')),
      })
    }

    it('offers the anchor toolbar instead of ordinary formatting', async () => {
      const screen = mountAnchorEditor()

      await expect
        .element(screen.getByRole('button', { name: 'Comment on selection' }))
        .toBeVisible()
      expect(screen.getByRole('button', { name: 'Bold' }).query()).toBeNull()
    })

    it('blocks ordinary typing, since surrounding text cannot change in this mode', async () => {
      const screen = mountAnchorEditor()

      await screen.getByRole('textbox', { name: 'New entry' }).click()
      await userEvent.keyboard('extra words')

      expect(changes).toEqual([])
      await expect.element(screen.getByText('I went to Lake Tahoe with Dad')).toBeVisible()
    })

    it('marks a selection as a comment anchor', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      selectTextRange(editorLocator.element(), 10, 20)

      await screen.getByRole('button', { name: 'Comment on selection' }).click()

      const latest = changes[changes.length - 1]!
      expect(latest.anchorIds).toHaveLength(1)
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: 'comment', quote: 'Lake Tahoe' })
      // A comment is a mark on existing text, not new content — the flattening never changes.
      expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad')
    })

    it('pairs a strike with replacement wording under one anchor id', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      selectTextRange(editorLocator.element(), 10, 20)

      await screen.getByRole('button', { name: 'Strike selection' }).click()
      await screen.getByLabelText('Replacement wording').fill('Donner Lake')
      await screen.getByRole('button', { name: 'Insert' }).click()

      const latest = changes[changes.length - 1]!
      expect(latest.anchorIds).toHaveLength(1)
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({
        kind: 'strike',
        quote: 'Lake Tahoe',
        insertion: 'Donner Lake',
      })
      // The replacement wording is presentational, not part of what the parent's author wrote.
      expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad')
    })

    it('places a bare insertion at the caret when nothing is selected', async () => {
      const screen = mountAnchorEditor()

      await screen.getByLabelText('Insert wording here').fill('perhaps')
      await screen.getByRole('button', { name: 'Insert' }).click()

      const latest = changes[changes.length - 1]!
      expect(latest.anchorIds).toHaveLength(1)
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: null, insertion: 'perhaps' })
    })

    it('drops an anchor back out on undo', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      selectTextRange(editorLocator.element(), 10, 20)
      await screen.getByRole('button', { name: 'Comment on selection' }).click()
      expect(changes[changes.length - 1]!.anchorIds).toHaveLength(1)

      await screen.getByRole('textbox', { name: 'New entry' }).click()
      await userEvent.keyboard('{Control>}z{/Control}')

      expect(changes[changes.length - 1]!.anchorIds).toEqual([])
    })
  })
})
