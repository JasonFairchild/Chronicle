import { beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import DocumentEditor, { type EditorChange } from '@/components/DocumentEditor.vue'
import { anchorsPlacedSince, collectAnchors } from '@/domain/anchors'
import { withAnchorMark } from '@/testing/anchorFixtures'
import {
  ANCHOR_INSERT_NODE,
  ANCHOR_MARK,
  collectMediaRefs,
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
    expect(latest.is_formatting).toBe(false)
  })

  it('reports the title beside the body it types into, as a separate field', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')

    const latest = changes[changes.length - 1]!
    expect(latest.title).toBe('Lake Tahoe')
    expect(docToPlainText(latest.content)).toBe('We drove up on Friday.')
  })

  it('moves from the title into the body on Enter, rather than submitting the form', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')

    const latest = changes[changes.length - 1]!
    expect(latest.title).toBe('Lake Tahoe')
    expect(docToPlainText(latest.content)).toBe('We drove up on Friday.')
  })

  it('moves from the title into the body on Tab, skipping the toolbar between them', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Tab}We drove up on Friday.')

    const latest = changes[changes.length - 1]!
    expect(latest.title).toBe('Lake Tahoe')
    expect(docToPlainText(latest.content)).toBe('We drove up on Friday.')
  })

  it('leaves the title untouched by the toolbar, which is the body’s alone', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('combobox', { name: 'Text style' }).selectOptions('Heading')

    // The title is not in the editor's document at all, so a block-type command cannot reach it.
    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    expect(changes[changes.length - 1]!.title).toBe('Lake Tahoe')
  })

  it('reports a formatting change as formatting, since it inserts no words', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'Bold' }).click()

    const latest = changes[changes.length - 1]!
    expect(latest.is_formatting).toBe(true)
    expect(latest.inserted_text).toBe('')
  })

  it('reports a change of block type as formatting, since it moves no words', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('combobox', { name: 'Text style' }).selectOptions('Heading')

    // A heading arrives as a replaceAround step, which no step type tells apart from an edit.
    const latest = changes[changes.length - 1]!
    expect(latest.is_formatting).toBe(true)
    // Trimmed because the editor adds an empty block after a trailing heading, which is its
    // scaffolding rather than anything the author wrote.
    expect(docToPlainText(latest.content).trim()).toBe('Worth remembering')
  })

  it('reports no deletion for wrapping a paragraph in a list', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'List' }).click()

    // Wrapping arrives as a `replaceAround` spanning the whole paragraph, with its content
    // reinserted through the gap — naive arithmetic would report the paragraph as deleted.
    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content).trim()).toBe('Worth remembering')
    expect(latest.removed_chars).toBe(0)
  })

  it('leaves the caret in the document after a toolbar click, so typing carries on', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('Worth remembering')
    await screen.getByRole('button', { name: 'Quote' }).click()
    await userEvent.keyboard(', and worth keeping')

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content).trim()).toBe('Worth remembering, and worth keeping')
  })

  it('reports a title change, but produces no steps for it', async () => {
    const screen = mountEditor({ withTitle: true })

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')

    const latest = changes[changes.length - 1]!
    expect(latest.title).toBe('Lake Tahoe')
    // The title is a plain field beside the editor, so there is no step chain it belongs to. Its
    // history is the value at each save point, read back from the entry's version chain.
    expect(latest.steps).toEqual([])
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
    expect(changes[changes.length - 1]!.is_formatting).toBe(true)
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
      title: 'Lake Tahoe',
      content: serializeDocument(plainTextDocument('We drove up on Friday.')),
    })

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    await expect.element(screen.getByText('We drove up on Friday.')).toBeVisible()
  })

  it('shows a disabled entry’s title as text, not a textbox someone could try to type into', async () => {
    const screen = mountEditor({
      withTitle: true,
      disabled: true,
      title: 'Lake Tahoe',
      content: serializeDocument(plainTextDocument('We drove up on Friday.')),
    })

    expect(screen.getByRole('textbox', { name: 'Title' }).query()).toBeNull()
    await expect.element(screen.getByText('Lake Tahoe')).toBeVisible()
  })

  it('omits the title entirely once it is not editable and was never given one', async () => {
    const screen = mountEditor({ withTitle: true, disabled: true })

    expect(screen.getByRole('textbox', { name: 'Title' }).query()).toBeNull()
    expect(screen.getByText('Lake Tahoe').query()).toBeNull()
  })

  it('stores an attached image in the media store and refers to it by id alone', async () => {
    const screen = mountEditor()

    await screen.getByLabelText('Attach an image').upload(pngFile())
    await expect.element(screen.getByRole('img')).toBeVisible()

    const latest = changes[changes.length - 1]!
    const [mediaRef] = collectMediaRefs(latest.content)
    expect(mediaRef).toBeTruthy()
    // An attachment adds no words, but it is content all the same.
    expect(latest.is_formatting).toBe(false)
    expect(latest.media_changed).toBe(true)
    expect(await mediaRepository.get(mediaRef!)).not.toBeNull()
    // The bytes never enter the document: an object URL is minted per page load and would be a
    // broken reference the moment this entry was read again.
    expect(latest.content).not.toContain('blob:')
    expect(latest.content).not.toContain('data:')
  })

  it('bookmarks a paste, distinct from ordinary typing', async () => {
    const screen = mountEditor()
    const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
    await expect.element(editorLocator).toBeVisible()
    editorLocator.element().focus()

    // Neither runner has a first-class paste: ProseMirror's own view reads `event.clipboardData`
    // straight off whatever `paste` event its DOM node receives, trusted or not, so a hand-built
    // `ClipboardEvent` carrying a `DataTransfer` is dispatched directly at the contenteditable.
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', 'Copied from elsewhere')
    editorLocator
      .element()
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }))

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toContain('Copied from elsewhere')
    expect(latest.is_paste).toBe(true)
  })

  describe('anchor mode', () => {
    function mountAnchorEditor(
      content: string = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad')),
      props: Record<string, unknown> = {},
    ) {
      return mountEditor({ anchorMode: true, content, ...props })
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

    it('offers the anchor menu over a selection instead of ordinary formatting', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      selectTextRange(editorLocator.element(), 10, 20)

      await expect.element(screen.getByRole('button', { name: 'Highlight' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Bold' }).query()).toBeNull()
    })

    it('marks a selection as a highlight, types wording, and accepts it as one gesture', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)

      await screen.getByRole('button', { name: 'Highlight' }).click()
      await userEvent.keyboard('Donner Lake{Enter}')

      const latest = changes[changes.length - 1]!
      expect(latest.anchorIds).toHaveLength(1)
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({
        kind: 'comment',
        quote: 'Lake Tahoe',
        insertion: 'Donner Lake',
      })
      // The wording is presentational, not part of what the parent's author wrote.
      expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad')
    })

    it('pairs a strike with replacement wording under one anchor id', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)

      // `exact: true`: a plain substring match would also catch the ordinary formatting toolbar's
      // "Strikethrough" toggle wherever one coexists on the page.
      await screen.getByRole('button', { name: 'Strike', exact: true }).click()
      await userEvent.keyboard('Donner Lake{Enter}')

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
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 0, 0)

      await userEvent.keyboard('perhaps{Enter}')

      const latest = changes[changes.length - 1]!
      expect(latest.anchorIds).toHaveLength(1)
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: null, insertion: 'perhaps' })
    })

    it('removes a bare insertion via its own trash button, same as a marked anchor', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 0, 0)

      await userEvent.keyboard('perhaps')
      await screen.getByRole('button', { name: 'Remove anchor' }).click()

      const latest = changes[changes.length - 1]!
      expect(latest.anchorIds).toEqual([])
      // The node shrinks the document, but its wording was never the parent's text to begin with
      // (`nodeText` skips `anchorInsert`) — `textBetween` over its range reads as empty, not removed.
      expect(latest.removed_chars).toBe(0)
    })

    it('trims whitespace off a selection’s edges before anchoring it', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()

      // " Lake Tahoe " (9-21) carries a space on both sides of the word "Lake Tahoe" (10-20).
      selectTextRange(editorLocator.element(), 9, 21)
      await screen.getByRole('button', { name: 'Highlight' }).click()
      await userEvent.keyboard('Donner Lake{Enter}')

      const [anchor] = collectAnchors(changes[changes.length - 1]!.content)
      expect(anchor).toMatchObject({ quote: 'Lake Tahoe', kind: 'comment' })
    })

    it('places a highlight and its wording through the keyboard alone', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)

      await userEvent.keyboard('{Control>}{Alt>}h{/Alt}{/Control}')
      await userEvent.keyboard('Donner Lake{Enter}')

      const latest = changes[changes.length - 1]!
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: 'comment', insertion: 'Donner Lake' })
    })

    it('discards an open wording input on Escape', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)

      await screen.getByRole('button', { name: 'Highlight' }).click()
      await userEvent.keyboard('Donner')
      await userEvent.keyboard('{Escape}')

      const latest = changes[changes.length - 1]!
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: 'comment', insertion: null })
    })

    it('does not let wording typed after a sealed anchor absorb it', async () => {
      // "sealed-1" stands for an anchor an earlier child already placed and sealed — present in
      // the document this editor opened with, not something this session placed.
      const screen = mountAnchorEditor(
        withAnchorMark('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20),
      )
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 20, 20)

      await userEvent.keyboard('!')

      const latest = changes[changes.length - 1]!
      const anchors = collectAnchors(latest.content)
      expect(anchors).toHaveLength(2)
      expect(anchors.find((anchor) => anchor.anchor_id === 'sealed-1')).toMatchObject({
        insertion: null,
      })
      const bare = anchors.find((anchor) => anchor.anchor_id !== 'sealed-1')
      expect(bare).toMatchObject({ kind: null, insertion: '!' })
      // The sealed anchor was already there — only the bare insertion is this session's own.
      expect(latest.anchorIds).toEqual([bare?.anchor_id])
    })

    it('drops an anchor back out on undo', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)
      await screen.getByRole('button', { name: 'Highlight' }).click()
      expect(changes[changes.length - 1]!.anchorIds).toHaveLength(1)

      // Placing a mark opens its wording box focused and ready to type, so undoing from the
      // keyboard needs focus back in the document first — same as a real reader clicking back in.
      editorLocator.element().focus()
      await userEvent.keyboard('{Control>}z{/Control}')

      const change = changes[changes.length - 1]!
      expect(change.anchorIds).toEqual([])
      // Judged by outcome, not by transaction provenance (`contentDelta`): undoing a placement
      // removes the anchor from the document's anchor set the same as `removeAnchor` would, so this
      // reads as an anchor change rather than formatting, with no undo-specific case needed.
      expect(change.is_anchor_op).toBe(true)
      expect(change.is_formatting).toBe(false)
    })

    describe('editing an anchor already placed this session', () => {
      /** Places a highlight over "Lake Tahoe" and commits "Donner Lake" as its wording. */
      async function placeHighlightWithWording(screen: ReturnType<typeof mountAnchorEditor>) {
        const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
        await expect.element(editorLocator).toBeVisible()
        editorLocator.element().focus()
        selectTextRange(editorLocator.element(), 10, 20)
        await screen.getByRole('button', { name: 'Highlight' }).click()
        await userEvent.keyboard('Donner Lake{Enter}')
        return editorLocator
      }

      it('reopens a placed anchor’s wording box by clicking it, with the wording already there', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)

        await screen.getByRole('button', { name: 'Edit wording' }).click()

        await expect
          .element(screen.getByRole('textbox', { name: 'Wording' }))
          .toHaveValue('Donner Lake')

        await userEvent.keyboard('{End} Tahoe{Enter}')

        const latest = changes[changes.length - 1]!
        const [anchor] = collectAnchors(latest.content)
        expect(anchor).toMatchObject({ insertion: 'Donner Lake Tahoe' })
        // Typing wording is typing — it isn't a structural anchor op the way placing, converting,
        // or removing one is (see `contentDelta`'s `sameAnchors`); it earns a bookmark the same way
        // prose does, which the next test covers.
        expect(latest.is_anchor_op).toBe(false)
        expect(latest.is_formatting).toBe(false)
      })

      it('reports a keystroke in a reopened wording box as ordinary text entry', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)

        await screen.getByRole('button', { name: 'Edit wording' }).click()
        await userEvent.keyboard('{End}.')

        const latest = changes[changes.length - 1]!
        // What the mark policy's punctuation check reads — see `insertedTextOf`.
        expect(latest.inserted_text.endsWith('.')).toBe(true)
        expect(latest.is_anchor_op).toBe(false)
        expect(latest.is_formatting).toBe(false)
      })

      it('switches a placed anchor’s kind from its reopened wording box', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)

        await screen.getByRole('button', { name: 'Edit wording' }).click()
        await screen.getByRole('button', { name: 'Strike', exact: true }).click()

        const latest = changes[changes.length - 1]!
        const [anchor] = collectAnchors(latest.content)
        expect(anchor).toMatchObject({ kind: 'strike', insertion: 'Donner Lake' })
        expect(latest.is_anchor_op).toBe(true)
        // The relation this note reads as follows the final kind at seal time — switching to a
        // strike here is exactly what makes the note read as a correction rather than a comment.
      })

      it('removes a placed anchor entirely from its reopened wording box', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)
        expect(changes[changes.length - 1]!.anchorIds).toHaveLength(1)

        await screen.getByRole('button', { name: 'Edit wording' }).click()
        await screen.getByRole('button', { name: 'Remove anchor' }).click()

        const latest = changes[changes.length - 1]!
        expect(collectAnchors(latest.content)).toEqual([])
        expect(latest.anchorIds).toEqual([])
        expect(latest.is_anchor_op).toBe(true)
        // The marked text itself is never touched — only the mark on it.
        expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad')
      })

      it('restores a reopened anchor’s prior wording on Escape, rather than discarding it', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)

        await screen.getByRole('button', { name: 'Edit wording' }).click()
        await userEvent.keyboard('{End}{Shift>}{Home}{/Shift}Something else entirely')

        // Proves Escape is discarding something real, not just leaving the original untouched.
        const beforeEscape = changes[changes.length - 1]!
        expect(collectAnchors(beforeEscape.content)[0]).toMatchObject({
          insertion: 'Something else entirely',
        })

        await userEvent.keyboard('{Escape}')

        const latest = changes[changes.length - 1]!
        const [anchor] = collectAnchors(latest.content)
        expect(anchor).toMatchObject({ insertion: 'Donner Lake' })
      })

      it('does not let a click reopen a sealed anchor from an earlier child', async () => {
        // "sealed-1" stands for an anchor an earlier child already placed and sealed.
        const screen = mountAnchorEditor(
          withAnchorMark('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20),
        )
        const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
        await expect.element(editorLocator).toBeVisible()

        await editorLocator.getByText('Lake Tahoe').click()

        expect(screen.getByRole('button', { name: 'Edit wording' }).query()).toBeNull()
        expect(changes).toHaveLength(0)
      })

      it('reopens a placed anchor selected exactly, instead of changing its kind or layering a second one over it', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)
        const placed = changes[changes.length - 1]!

        // The same range the highlight covers, selected again from scratch.
        selectTextRange(editorLocator.element(), 10, 20)
        await screen.getByRole('button', { name: 'Strike', exact: true }).click()

        await expect
          .element(screen.getByRole('textbox', { name: 'Wording' }))
          .toHaveValue('Donner Lake')
        // Opening the box changes nothing about the document itself, so no new update fires.
        expect(changes[changes.length - 1]).toBe(placed)
      })

      it('opens a placed anchor’s box for a selection overlapping it at all, rather than creating a second anchor', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)
        const placed = changes[changes.length - 1]!

        // "Tahoe with" (15-25) overlaps the placed "Lake Tahoe" highlight (10-20) without matching it.
        selectTextRange(editorLocator.element(), 15, 25)
        await screen.getByRole('button', { name: 'Highlight' }).click()

        await expect
          .element(screen.getByRole('textbox', { name: 'Wording' }))
          .toHaveValue('Donner Lake')
        expect(changes[changes.length - 1]).toBe(placed)
      })

      it('lets a session placed before a resume keep editing an anchor placed before the resume', async () => {
        // Stands for a draft resumed after a reload: "resumed-1" was placed and persisted before
        // the reload, so it's already in the document this editor mounts with. The base — the
        // parent as the session first found it, `Draft.parent.base_content` — is what still tells
        // it apart from an anchor an earlier child sealed.
        const base = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad'))
        const seeded = withAnchorMarkAndWording(
          'I went to Lake Tahoe with Dad',
          'resumed-1',
          10,
          20,
          'Donner Lake',
        )
        expect(anchorsPlacedSince(base, seeded)).toEqual(['resumed-1'])

        const screen = mountAnchorEditor(seeded, { anchorBaseContent: base })
        const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
        await expect.element(editorLocator).toBeVisible()

        // The anchor from before the resume is still clickable...
        await screen.getByRole('button', { name: 'Edit wording' }).click()
        await expect
          .element(screen.getByRole('textbox', { name: 'Wording' }))
          .toHaveValue('Donner Lake')
        await userEvent.keyboard('{Escape}')

        // ...and placing a new one this session reports both ids as this session's own.
        editorLocator.element().focus()
        selectTextRange(editorLocator.element(), 21, 25)
        await screen.getByRole('button', { name: 'Highlight' }).click()
        await userEvent.keyboard('note{Enter}')

        const latest = changes[changes.length - 1]!
        expect(latest.anchorIds).toContain('resumed-1')
        expect(latest.anchorIds).toHaveLength(2)
      })
    })
  })
})
