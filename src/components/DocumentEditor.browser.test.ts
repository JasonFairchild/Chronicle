import { beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import DocumentEditor from '@/components/DocumentEditor.vue'
import { anchorsPlacedSince, collectAnchors } from '@/domain/anchors'
import { collectMediaRefs, docToPlainText, MEDIA_NODE } from '@/domain/entryDocument'
import { TraceRecorder } from '@/domain/traceRecorder'
import { documentsAt } from '@/editor/replay'
import { mediaRepository } from '@/repositories'
import { withAnchorMark, withAnchorWording } from '@/testing/anchorFixtures'
import { plainTextDocument, serializeDocument } from '@/testing/documents'
import { renderComponent } from '@/testing/renderComponent'
import { selectTextRange } from '@/testing/selectTextRange'
import type { DraftChange } from '@/types/draft'

/** Neither runner has a first-class paste, so a hand-built one goes straight at the document. */
function paste(editorEl: Element, data: Record<string, string>): void {
  const dataTransfer = new DataTransfer()
  for (const [type, value] of Object.entries(data)) dataTransfer.setData(type, value)
  editorEl.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }),
  )
}

describe('DocumentEditor (browser)', () => {
  let changes: DraftChange[]

  beforeEach(() => {
    changes = []
  })

  function mountEditor(props: Record<string, unknown> = {}) {
    return renderComponent(DocumentEditor, {
      props: { label: 'New entry', ...props },
      attrs: {
        onChange: (change: DraftChange) => {
          changes.push(change)
        },
      },
    })
  }

  /** Seals every change reported into a trace, the way a draft does, and replays it to the end. */
  function replayAll(base: string) {
    const recorder = new TraceRecorder('session-1', '2026-09-22T10:00:00.000Z')
    for (const change of changes) recorder.record(change)
    const { events } = recorder.seal()!
    return documentsAt({ base_content: base, events }, [events.length])
  }

  it('reports the document it holds along with the steps that produced it', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('It rained all day.')

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toBe('It rained all day.')
    expect(latest.steps.length).toBeGreaterThan(0)
    expect(latest.is_formatting).toBe(false)
  })

  it('reports a link as formatting', async () => {
    const screen = mountEditor()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('The trail report')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'Link' }).click()
    await screen.getByLabelText('Link address').fill('https://example.com/trail')
    await screen.getByRole('button', { name: 'Apply link' }).click()

    await expect.element(screen.getByRole('link', { name: 'The trail report' })).toBeVisible()
    expect(changes[changes.length - 1]!.is_formatting).toBe(true)
  })

  it('reports nothing when only its editability changes', async () => {
    // Rendered directly rather than through the helper, so `rerender` knows these exact props.
    const screen = renderComponent(DocumentEditor, {
      props: { label: 'New entry', disabled: true },
      attrs: {
        onChange: (change: DraftChange) => {
          changes.push(change)
        },
      },
    })

    await screen.rerender({ disabled: false })

    // Whether a document may be edited is not a change to the document. Reporting one starts a
    // writing session nobody began, which showed up as an empty draft per visit to the page.
    expect(changes).toEqual([])
  })

  it('holds the paragraph it adds after a trailing heading until the writer changes something', async () => {
    const screen = mountEditor({
      content: serializeDocument({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lake Tahoe' }] },
        ],
      }),
    })
    const editorLocator = screen.getByRole('textbox', { name: 'New entry' })

    await editorLocator.click()
    expect(changes).toEqual([])

    await userEvent.keyboard('!')
    // The editor's own paragraph, then the keystroke.
    expect(changes).toHaveLength(1)
    expect(changes[0]!.steps).toHaveLength(2)
  })

  it('opens an existing document where its author left it', async () => {
    const screen = mountEditor({
      content: serializeDocument(plainTextDocument('We drove up on Friday.')),
    })

    await expect.element(screen.getByText('We drove up on Friday.')).toBeVisible()
  })

  it('shows a document that is only displayed as text, with no toolbar or field to type in', async () => {
    const screen = mountEditor({
      displayOnly: true,
      content: serializeDocument(plainTextDocument('We drove up on Friday.')),
    })

    await expect.element(screen.getByText('We drove up on Friday.')).toBeVisible()
    expect(screen.getByRole('toolbar').query()).toBeNull()
    expect(screen.getByRole('textbox').query()).toBeNull()
  })

  it('shows a stored image in a displayed document', async () => {
    const mediaRef = await mediaRepository.put(
      new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    )
    const screen = mountEditor({
      displayOnly: true,
      content: serializeDocument({
        type: 'doc',
        content: [{ type: MEDIA_NODE, attrs: { mediaRef, alt: 'lake.png' } }],
      }),
    })

    await expect
      .element(screen.getByRole('img', { name: 'lake.png' }))
      .toHaveAttribute('src', expect.stringMatching(/^blob:/))
  })

  it('shows an attached image from its stored bytes, and refers to it by id alone', async () => {
    const screen = mountEditor()
    const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'lake.png', {
      type: 'image/png',
    })

    await screen.getByTestId('image-file-input').upload(png)
    await expect
      .element(screen.getByRole('img'))
      .toHaveAttribute('src', expect.stringMatching(/^blob:/))

    const latest = changes[changes.length - 1]!
    expect(collectMediaRefs(latest.content)).toHaveLength(1)
    // An attachment adds no words, but it is content all the same.
    expect(latest.is_formatting).toBe(false)
    expect(latest.media_changed).toBe(true)
    // The bytes never enter the document: an object URL is minted per page load and would be a
    // broken reference the moment this entry was read again.
    expect(latest.content).not.toContain('blob:')
    expect(latest.content).not.toContain('data:')
  })

  it('reports a paste through its own clipboard handling as a paste', async () => {
    const screen = mountEditor()
    const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
    await expect.element(editorLocator).toBeVisible()
    editorLocator.element().focus()

    // ProseMirror's own view reads `event.clipboardData` straight off whatever `paste` event its DOM
    // node receives, trusted or not.
    paste(editorLocator.element(), { 'text/plain': 'Copied from elsewhere' })

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toContain('Copied from elsewhere')
    expect(latest.is_paste).toBe(true)
  })

  it('pastes anchored text without its anchor', async () => {
    const screen = mountEditor()
    const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
    await expect.element(editorLocator).toBeVisible()
    editorLocator.element().focus()

    paste(editorLocator.element(), {
      'text/html':
        '<p>It <span data-anchor-id="anchor-1" data-anchor-kind="comment">rained</span>' +
        '<ins data-anchor-id="anchor-1">heavily</ins></p>',
    })

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toBe('It rainedheavily')
    expect(collectAnchors(latest.content)).toEqual([])
  })

  it('keeps the text under an anchor as it was in a revision', async () => {
    const screen = mountEditor({
      content: withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20),
    })
    const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
    await expect.element(editorLocator).toBeVisible()
    editorLocator.element().focus()

    selectTextRange(editorLocator.element(), 12, 12)
    await userEvent.keyboard('x')
    // Typing that goes through, after the refused keystroke.
    selectTextRange(editorLocator.element(), 29, 29)
    await userEvent.keyboard('!')

    const latest = changes[changes.length - 1]!
    expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad!')
    expect(collectAnchors(latest.content)).toMatchObject([{ quote: 'Lake Tahoe' }])
  })

  it('reports every step it takes, so the sealed log replays to the document exactly', async () => {
    // Ending in a heading makes the editor append an empty paragraph on its own, the first time
    // anything happens in it.
    const base = serializeDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lake Tahoe' }] },
      ],
    })
    const screen = mountEditor({ content: base })
    const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
    await expect.element(editorLocator).toBeVisible()

    // A link typed out in full, then a space, is turned into a link by the editor itself.
    await editorLocator.click()
    await userEvent.keyboard('{Control>}{End}{/Control}See https://example.com today.')
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'Bold' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}')
    paste(editorLocator.element(), { 'text/plain': ' Copied from elsewhere' })
    await userEvent.keyboard('{Control>}z{/Control}')
    // Clearing everything makes the editor reset what's left to a plain paragraph on its own.
    await userEvent.keyboard('{Control>}a{/Control}{Backspace}Starting over.')

    expect(replayAll(base)).toEqual([JSON.parse(changes[changes.length - 1]!.content)])
  })

  describe('anchor mode', () => {
    function mountAnchorEditor(
      content: string = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad')),
      props: Record<string, unknown> = {},
    ) {
      return mountEditor({ anchorMode: true, content, ...props })
    }

    it('offers the anchor menu over a selection instead of ordinary formatting', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      selectTextRange(editorLocator.element(), 10, 20)

      await expect.element(screen.getByRole('button', { name: 'Highlight passage' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Bold' }).query()).toBeNull()
    })

    it('marks a selection as a highlight, and takes what is typed next as its wording', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)

      await screen.getByRole('button', { name: 'Highlight passage' }).click()
      const placeholder = screen.getByText('Add wording…')
      await expect.element(placeholder).toBeVisible()
      await userEvent.keyboard('Donner Lake')

      const latest = changes[changes.length - 1]!
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({
        kind: 'comment',
        quote: 'Lake Tahoe',
        insertion: 'Donner Lake',
      })
      expect(docToPlainText(latest.content)).toBe('I went to Lake TahoeDonner Lake with Dad')
      await expect.element(placeholder).not.toBeInTheDocument()
    })

    it('pairs a strike with replacement wording under one anchor id', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)

      await screen.getByRole('button', { name: 'Strike passage' }).click()
      await userEvent.keyboard('Donner Lake')

      const latest = changes[changes.length - 1]!
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({
        kind: 'strike',
        quote: 'Lake Tahoe',
        insertion: 'Donner Lake',
      })
    })

    it('places a bare insertion at the caret when nothing is selected', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 0, 0)

      await userEvent.keyboard('perhaps')

      const latest = changes[changes.length - 1]!
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: null, insertion: 'perhaps' })
    })

    it('takes a list marker typed at a line’s start as wording', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 0, 0)

      await userEvent.keyboard('- ')

      const [anchor] = collectAnchors(changes[changes.length - 1]!.content)
      expect(anchor).toMatchObject({ kind: null, insertion: '- ' })
    })

    it('types wording plain, without the formatting of the text before it', async () => {
      const screen = mountAnchorEditor(
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
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 15, 15)

      await userEvent.keyboard('!')

      const typed = JSON.parse(changes[changes.length - 1]!.content).content[0].content[2]
      expect(typed.text).toBe('!')
      expect(typed.marks.map((mark: { type: string }) => mark.type)).toEqual(['anchorWording'])
    })

    it('takes a paste as wording typed on one line, and reports it as a paste', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 0, 0)

      paste(editorLocator.element(), { 'text/plain': 'Last\nsummer, ' })

      const latest = changes[changes.length - 1]!
      expect(collectAnchors(latest.content)).toMatchObject([
        { kind: null, insertion: 'Last summer, ' },
      ])
      expect(latest.is_paste).toBe(true)
    })

    it('ignores dropped text', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', 'Donner Lake')
      const { left, top } = editorLocator.element().querySelector('p')!.getBoundingClientRect()

      // Neither runner has a first-class drop, so a hand-built one goes at the first line's start.
      editorLocator
        .element()
        .dispatchEvent(new DragEvent('drop', { dataTransfer, clientX: left + 1, clientY: top + 1 }))

      // A drop is handled as it's dispatched, so a change it made would already be reported.
      expect(changes).toEqual([])
    })

    it('removes a bare insertion from the menu at its caret', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 0, 0)

      await userEvent.keyboard('perhaps')
      await screen.getByRole('button', { name: 'Remove anchor' }).click()

      const latest = changes[changes.length - 1]!
      expect(collectAnchors(latest.content)).toEqual([])
      expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad')
    })

    it('trims whitespace off a selection’s edges before anchoring it', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()

      // " Lake Tahoe " (9-21) carries a space on both sides of the word "Lake Tahoe" (10-20).
      selectTextRange(editorLocator.element(), 9, 21)
      await screen.getByRole('button', { name: 'Highlight passage' }).click()

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
      await userEvent.keyboard('Donner Lake')

      const latest = changes[changes.length - 1]!
      const [anchor] = collectAnchors(latest.content)
      expect(anchor).toMatchObject({ kind: 'comment', insertion: 'Donner Lake' })
    })

    it('does not let wording typed after a sealed anchor join it', async () => {
      // "sealed-1" stands for an anchor an earlier related entry already placed and sealed — present in
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
    })

    it('leaves a sealed anchor alone: typing in its passage or its wording does nothing', async () => {
      // "Lake Tahoe" is 10-20 and its wording "Donner Lake" 20-31.
      const screen = mountAnchorEditor(
        withAnchorWording('I went to Lake Tahoe with Dad', 'sealed-1', 10, 20, 'Donner Lake'),
      )
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()

      selectTextRange(editorLocator.element(), 12, 12)
      await userEvent.keyboard('x')
      selectTextRange(editorLocator.element(), 25, 25)
      await userEvent.keyboard('x')
      // Typing that goes through, after the refused keystrokes.
      selectTextRange(editorLocator.element(), 40, 40)
      await userEvent.keyboard('!')

      const latest = changes[changes.length - 1]!
      expect(collectAnchors(latest.content)).toMatchObject([
        { anchor_id: 'sealed-1', quote: 'Lake Tahoe', insertion: 'Donner Lake' },
        { kind: null, insertion: '!' },
      ])
    })

    it('drops an anchor back out on Undo', async () => {
      const screen = mountAnchorEditor()
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()
      selectTextRange(editorLocator.element(), 10, 20)
      await screen.getByRole('button', { name: 'Highlight passage' }).click()
      expect(collectAnchors(changes[changes.length - 1]!.content)).toHaveLength(1)

      await screen.getByRole('button', { name: 'Undo' }).click()

      const change = changes[changes.length - 1]!
      expect(collectAnchors(change.content)).toEqual([])
      // Judged by outcome, not by transaction provenance (`contentDelta`): undoing a placement
      // removes the anchor from the document's anchor set the same as `removeAnchor` would, so this
      // reads as an anchor change rather than formatting, with no undo-specific case needed.
      expect(change.is_anchor_op).toBe(true)
      expect(change.is_formatting).toBe(false)
    })

    it('reports every step it takes, so the sealed log replays to the document exactly', async () => {
      const base = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad'))
      const screen = mountAnchorEditor(base)
      const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
      await expect.element(editorLocator).toBeVisible()
      editorLocator.element().focus()

      selectTextRange(editorLocator.element(), 10, 20)
      await screen.getByRole('button', { name: 'Highlight passage' }).click()
      await userEvent.keyboard('Donner Lake')
      await userEvent.keyboard('{Control>}{Alt>}s{/Alt}{/Control}')
      selectTextRange(editorLocator.element(), 0, 0)
      await userEvent.keyboard('perhaps')
      await userEvent.keyboard('{Control>}z{/Control}')

      expect(replayAll(base)).toEqual([JSON.parse(changes[changes.length - 1]!.content)])
    })

    describe('editing an anchor already placed this session', () => {
      /** Places a highlight over "Lake Tahoe" and types "Donner Lake" as its wording. */
      async function placeHighlightWithWording(screen: ReturnType<typeof mountAnchorEditor>) {
        const editorLocator = screen.getByRole('textbox', { name: 'New entry' })
        await expect.element(editorLocator).toBeVisible()
        editorLocator.element().focus()
        selectTextRange(editorLocator.element(), 10, 20)
        await screen.getByRole('button', { name: 'Highlight passage' }).click()
        await userEvent.keyboard('Donner Lake')
        return editorLocator
      }

      it('returns to the end of a placed anchor’s wording when its passage is clicked', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)
        selectTextRange(editorLocator.element(), 0, 0)

        await editorLocator.getByText('Lake Tahoe').click()
        await userEvent.keyboard('{Backspace}')

        const [anchor] = collectAnchors(changes[changes.length - 1]!.content)
        expect(anchor).toMatchObject({ quote: 'Lake Tahoe', insertion: 'Donner Lak' })
      })

      it('puts the caret where its wording is clicked', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)
        selectTextRange(editorLocator.element(), 0, 0)

        // The wording's left edge, before its first letter.
        await editorLocator.getByText('Donner Lake').click({ position: { x: 1, y: 5 } })
        await userEvent.keyboard('!')

        const [anchor] = collectAnchors(changes[changes.length - 1]!.content)
        expect(anchor).toMatchObject({ quote: 'Lake Tahoe', insertion: '!Donner Lake' })
      })

      it('puts typing on its passage at the end of its wording', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)

        selectTextRange(editorLocator.element(), 12, 12)
        await userEvent.keyboard('!')

        const [anchor] = collectAnchors(changes[changes.length - 1]!.content)
        expect(anchor).toMatchObject({ quote: 'Lake Tahoe', insertion: 'Donner Lake!' })
      })

      it('puts a paste on its passage at the end of its wording, as typing', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)

        selectTextRange(editorLocator.element(), 12, 12)
        paste(editorLocator.element(), { 'text/plain': '!' })

        const latest = changes[changes.length - 1]!
        const [anchor] = collectAnchors(latest.content)
        expect(anchor).toMatchObject({ quote: 'Lake Tahoe', insertion: 'Donner Lake!' })
        expect(latest.is_paste).toBe(true)
      })

      it('reports a keystroke in its wording as ordinary text entry', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)

        await userEvent.keyboard('.')

        const latest = changes[changes.length - 1]!
        // What the mark policy's punctuation check reads — see `changeSignals`.
        expect(latest.inserted_text).toBe('.')
        expect(latest.is_anchor_op).toBe(false)
        expect(latest.is_formatting).toBe(false)
      })

      it('switches a placed anchor’s kind from the menu at its caret', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)

        await screen.getByRole('button', { name: 'Strike passage' }).click()

        const latest = changes[changes.length - 1]!
        const [anchor] = collectAnchors(latest.content)
        expect(anchor).toMatchObject({ kind: 'strike', insertion: 'Donner Lake' })
        expect(latest.is_anchor_op).toBe(true)
      })

      it('removes a placed anchor and its wording from the menu at its caret', async () => {
        const screen = mountAnchorEditor()
        await placeHighlightWithWording(screen)
        expect(collectAnchors(changes[changes.length - 1]!.content)).toMatchObject([
          { quote: 'Lake Tahoe', insertion: 'Donner Lake' },
        ])

        await screen.getByRole('button', { name: 'Remove anchor' }).click()

        const latest = changes[changes.length - 1]!
        expect(collectAnchors(latest.content)).toEqual([])
        expect(latest.is_anchor_op).toBe(true)
        // The passage stays, as the parent's text; only its wording is deleted.
        expect(docToPlainText(latest.content)).toBe('I went to Lake Tahoe with Dad')
        expect(latest.removed_chars).toBe('Donner Lake'.length)
      })

      it.each([
        ['selected exactly', 10, 20],
        ['overlapped past its end', 25, 36],
      ] as const)(
        'returns to a placed anchor %s, rather than changing its kind or placing a second',
        async (_how, from, to) => {
          const screen = mountAnchorEditor()
          const editorLocator = await placeHighlightWithWording(screen)

          selectTextRange(editorLocator.element(), from, to)
          await screen.getByRole('button', { name: 'Strike passage' }).click()
          await userEvent.keyboard('!')

          const anchors = collectAnchors(changes[changes.length - 1]!.content)
          expect(anchors).toMatchObject([{ kind: 'comment', insertion: 'Donner Lake!' }])
        },
      )

      it('places a new anchor on a selection that only meets a placed one’s edge', async () => {
        const screen = mountAnchorEditor()
        const editorLocator = await placeHighlightWithWording(screen)

        // " with" (31-36) starts where the placed anchor's wording ends.
        selectTextRange(editorLocator.element(), 31, 36)
        await screen.getByRole('button', { name: 'Strike passage' }).click()

        expect(collectAnchors(changes[changes.length - 1]!.content)).toMatchObject([
          { kind: 'comment', quote: 'Lake Tahoe', insertion: 'Donner Lake' },
          { kind: 'strike', quote: 'with' },
        ])
      })

      it('lets a resumed session keep editing an anchor it placed before the resume', async () => {
        // Stands for a draft resumed after a reload: "resumed-1" was placed and persisted before
        // the reload, so it's already in the document this editor mounts with. The base — the
        // parent as the session first found it, the version `Draft.parent.base_version_id` names —
        // is what still tells it apart from an anchor an earlier related entry sealed.
        const base = serializeDocument(plainTextDocument('I went to Lake Tahoe with Dad'))
        const seeded = withAnchorWording(
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

        await editorLocator.getByText('Lake Tahoe').click()
        await userEvent.keyboard('!')

        await expect.element(editorLocator).toHaveTextContent('Donner Lake! with Dad')
        const [anchor] = collectAnchors(changes[changes.length - 1]!.content)
        expect(anchor).toMatchObject({ anchor_id: 'resumed-1', insertion: 'Donner Lake!' })
      })
    })
  })
})
