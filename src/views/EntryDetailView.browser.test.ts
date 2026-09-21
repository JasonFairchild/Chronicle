import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import EntryDetailView from '@/views/EntryDetailView.vue'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import type { OpfsMediaRepository } from '@/repositories/opfsMediaRepository'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import {
  freshDraftRepository,
  freshEntryRepository,
  freshMediaRepository,
} from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { selectTextRange } from '@/testing/selectTextRange'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate } from '@/utils/format'

const PARENT_TEXT = 'I went to Lake Tahoe with Dad'
const PARENT_CONTENT = textContent(PARENT_TEXT)

async function mountDetail(id: string) {
  const router = createTestRouter()
  await router.push('/')
  await router.isReady()

  return renderComponent(EntryDetailView, {
    props: { id },
    global: { plugins: [router] },
  })
}

describe('EntryDetailView (browser)', () => {
  // A fresh, isolated real repository per test, pointed at by the composition root, so the
  // mounted component's own useEntriesStore() call reaches the same instance this file seeds.
  let repository: DexieEntryRepository
  let media: OpfsMediaRepository
  let drafts: DexieDraftRepository

  beforeEach(() => {
    repository = freshEntryRepository()
    media = freshMediaRepository()
    drafts = freshDraftRepository()
  })

  it('renders the entry’s own text', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
  })

  it('shows a child entry separately rather than spliced into the parent', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))
    await repository.create(
      createEntryInput({
        content: textContent('It was actually Donner Lake'),
        parent_id: parent.id,
        relation_type: 'update',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText('It was actually Donner Lake')).toBeVisible()
    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
  })

  it('describes which passage an anchored child is about', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'strike')
    const parent = await repository.create(createEntryInput({ content: marked }))
    await repository.create(
      createEntryInput({
        content: textContent('Wrong lake'),
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText('Strikes “Lake Tahoe”')).toBeVisible()
  })

  it('keeps the original wording visible when a revision orphans an anchor', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'strike')
    const parent = await repository.create(createEntryInput({ content: marked }))
    await repository.create(
      createEntryInput({
        content: textContent('Wrong lake'),
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )
    await repository.create(
      createEntryInput({
        content: textContent('I stayed home that summer'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText('Was attached to: “Lake Tahoe”')).toBeVisible()
  })

  it('reports the version position once an entry has been revised', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))
    await repository.create(
      createEntryInput({
        content: textContent('I went to Donner Lake with Dad'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
    await expect.element(screen.getByText('I went to Donner Lake with Dad')).toBeVisible()
  })

  it('shows an incoming connection on the entry it points at', async () => {
    const target = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    await repository.create(
      createEntryInput({
        content: textContent('One made the other possible'),
        title: 'led_to',
        parent_id: source.id,
        target_id: target.id,
        relation_type: 'connection',
      }),
    )

    const screen = await mountDetail(target.id)

    await expect.element(screen.getByRole('link', { name: 'led_to' })).toBeVisible()
  })

  it('shows a child card’s created date', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))
    const child = await repository.create(
      createEntryInput({
        content: textContent('It was actually Donner Lake'),
        parent_id: parent.id,
        relation_type: 'update',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(formatDate(child.created_at))).toBeVisible()
  })

  it('opens the connection’s own page, not the far endpoint, when its card is clicked', async () => {
    const target = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const connection = await repository.create(
      createEntryInput({
        content: textContent('One made the other possible'),
        title: 'led_to',
        parent_id: source.id,
        target_id: target.id,
        relation_type: 'connection',
      }),
    )

    const screen = await mountDetail(target.id)

    await expect
      .element(screen.getByRole('link', { name: 'led_to' }))
      .toHaveAttribute('href', `/entries/${connection.id}`)
  })

  it('shows a breadcrumb back to the parent on a child’s own detail page', async () => {
    const parent = await repository.create(
      createEntryInput({ content: textContent('Left my job'), title: 'Career change' }),
    )
    const child = await repository.create(
      createEntryInput({
        content: textContent('Started the degree'),
        parent_id: parent.id,
        relation_type: 'update',
      }),
    )

    const screen = await mountDetail(child.id)

    await expect.element(screen.getByText('About')).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: 'Career change' }))
      .toHaveAttribute('href', `/entries/${parent.id}`)
  })

  it('shows a breadcrumb linking both sides on a connection’s own detail page', async () => {
    const target = await repository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const connection = await repository.create(
      createEntryInput({
        content: textContent('One made the other possible'),
        title: 'led_to',
        parent_id: source.id,
        target_id: target.id,
        relation_type: 'connection',
      }),
    )

    const screen = await mountDetail(connection.id)

    await expect.element(screen.getByText('Connects')).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: 'Left my job' }))
      .toHaveAttribute('href', `/entries/${source.id}`)
    await expect
      .element(screen.getByRole('link', { name: 'Started the degree' }))
      .toHaveAttribute('href', `/entries/${target.id}`)
  })

  it('reports a missing entry instead of failing silently', async () => {
    const screen = await mountDetail('does-not-exist')

    await expect.element(screen.getByText('Entry not found.')).toBeVisible()
  })

  it('shows the dates the writer gave, alongside when the entry was created', async () => {
    const parent = await repository.create(
      createEntryInput({
        content: PARENT_CONTENT,
        dates: {
          ...emptyEntryDates(),
          occurred_at: '1994-06-11',
          occurred_time_note: 'late morning',
          recorded_at: '1994-06-12',
        },
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(/Happened .*1994 · late morning/)).toBeVisible()
    await expect.element(screen.getByText(/Originally written .*1994/)).toBeVisible()
  })

  it('adds a note about the entry as a whole when the session marks nothing', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    await screen.getByRole('textbox', { name: 'Your note' }).click()
    await userEvent.keyboard('Still think about this trip')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    await expect.element(screen.getByText('Still think about this trip')).toBeVisible()

    const children = await repository.listChildren(parent.id)
    expect(children[0]?.anchors).toEqual([])
    // Nothing was marked, so the note claims nothing changed about the entry.
    expect(children[0]?.relation_type).toBe('annotation')
  })

  it('will not save a related entry that says nothing', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    // Typed into and then emptied: the document is no longer the blank one the session opened
    // with, but it still holds nothing worth keeping.
    await screen.getByRole('textbox', { name: 'Your note' }).click()
    await userEvent.keyboard('x{Backspace}')

    await expect.element(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled()
    expect(await repository.listChildren(parent.id)).toEqual([])

    await screen.getByRole('button', { name: 'Discard' }).click()
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
  })

  it('keeps a related entry in progress when the reader moves to another entry', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))
    const other = await repository.create(
      createEntryInput({ content: textContent('A different day entirely') }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    await screen.getByRole('textbox', { name: 'Your note' }).click()
    await userEvent.keyboard('Half a thought about this')

    // The session has to close — saving after this would seal against the wrong entry — but
    // closing it is not the same as throwing it away.
    await screen.rerender({ id: other.id })

    await vi.waitFor(async () => {
      const [draft] = await drafts.list()
      expect(draft?.target).toEqual({ kind: 'new_child', parent_id: parent.id })
      expect(docToPlainText(draft!.child.content)).toBe('Half a thought about this')
    })
  })

  it('shows the parent’s own title in the anchor-mode composer, not just its body', async () => {
    const parent = await repository.create(
      createEntryInput({ content: PARENT_CONTENT, title: 'The Tahoe trip' }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    const parentEditor = screen.getByRole('textbox', { name: 'Entry being annotated' })
    await expect.element(parentEditor).toBeVisible()

    // The page heading carries the parent's title too, so this looks specifically inside the
    // composer's own "Entry being annotated" half — the half that only shows a title because the
    // session seeds `parentTitle` — rather than passing on the heading above it.
    const editorRoot = parentEditor.element().closest('.rounded-lg')
    expect(editorRoot?.textContent).toContain('The Tahoe trip')
  })

  it('anchors a strike to the passage the user selects, in one atomic seal', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    const parentEditor = screen.getByRole('textbox', { name: 'Entry being annotated' })
    await expect.element(parentEditor).toBeVisible()
    parentEditor.element().focus()
    selectTextRange(parentEditor.element(), 10, 20)

    // `exact: true` matters here: this composer's other half (`Your note`) has its own ordinary
    // "Strikethrough" toggle, and a substring match would find that button instead — on the wrong
    // editor entirely.
    await screen.getByRole('button', { name: 'Strike', exact: true }).click()
    await userEvent.keyboard('D')
    await screen.getByRole('textbox', { name: 'Wording' }).fill('Donner Lake')
    await screen.getByRole('button', { name: 'Accept wording' }).click()

    await screen.getByRole('textbox', { name: 'Your note' }).click()
    await userEvent.keyboard('Wrong lake')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    await expect
      .element(screen.getByText('Strikes “Lake Tahoe”, replaced with “Donner Lake”'))
      .toBeVisible()

    const revisions = await repository.listRevisions(parent.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.revision_mode).toBe('anchor')

    const children = await repository.listChildren(parent.id)
    expect(children[0]?.anchors).toHaveLength(1)
    expect(children[0]?.anchors[0]?.quote).toBe('Lake Tahoe')
    // Striking reports a correction, so the note reads as an update without anyone being asked.
    expect(children[0]?.relation_type).toBe('update')
  })

  it('pairs a highlight with inline wording, which is what a highlight-plus-comment reads as', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    const parentEditor = screen.getByRole('textbox', { name: 'Entry being annotated' })
    await expect.element(parentEditor).toBeVisible()
    parentEditor.element().focus()
    selectTextRange(parentEditor.element(), 10, 20)

    await screen.getByRole('button', { name: 'Highlight' }).click()
    await userEvent.keyboard('D')
    await screen.getByRole('textbox', { name: 'Wording' }).fill('Donner Lake')
    await screen.getByRole('button', { name: 'Accept wording' }).click()

    await screen.getByRole('textbox', { name: 'Your note' }).click()
    await userEvent.keyboard('Actually')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    // A highlight is a mark on existing text, same as a strike, and wording rides along with it the
    // same way — so `relationTypeForAnchors` reads it as an `update`, and `describeAnchor`'s
    // `comment` case has to report the insertion rather than only the passage.
    await expect.element(screen.getByText('On “Lake Tahoe”, adds “Donner Lake”')).toBeVisible()

    const children = await repository.listChildren(parent.id)
    expect(children[0]?.relation_type).toBe('update')
  })

  it('warns before saving a revision that changes the text under an anchor', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await repository.create(createEntryInput({ content: marked }))
    await repository.create(
      createEntryInput({
        content: textContent('Wonderful trip'),
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    const editorLocator = screen.getByRole('textbox', { name: 'Revised entry' })
    await expect.element(editorLocator).toBeVisible()
    const editorEl = editorLocator.element()
    editorEl.focus()
    selectTextRange(editorEl, 10, 20)
    await userEvent.keyboard('{Backspace}')

    // The full sentence, not just that some warning fired: PRODUCT.md §4.5 requires naming the
    // note, not merely counting how many were affected.
    await expect
      .element(screen.getByText('This changes the passage Wonderful trip is about.'))
      .toBeVisible()

    // Neither assertion above completes the session, and the draft's debounced flush would
    // otherwise still be pending when this test ends — closing it here keeps that write from
    // landing in whichever repository the next test's `beforeEach` happens to have installed by
    // the time a stray timer fires.
    await screen.getByRole('button', { name: 'Discard revision' }).click()
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
  })

  it('stays quiet when a revision only moves an anchor, not the text it covers', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await repository.create(createEntryInput({ content: marked }))
    await repository.create(
      createEntryInput({
        content: textContent('Wonderful trip'),
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}!')

    expect(screen.getByText(/This changes the passage/).query()).toBeNull()

    await screen.getByRole('button', { name: 'Discard revision' }).click()
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
  })

  it('revises an entry by appending a version, leaving the original row untouched', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, or so I remembered it.')
    await screen.getByRole('button', { name: 'Save revision' }).click()

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()

    const revisions = await repository.listRevisions(parent.id)
    expect(docToPlainText(revisions[0]!.content)).toBe(`${PARENT_TEXT}, or so I remembered it.`)
    expect(revisions[0]?.revision_mode).toBe('direct')
    expect(revisions[0]?.authoring_trace?.steps.length).toBeGreaterThan(0)
    // The entry itself is never rewritten; the version chain is what carries the change.
    expect(docToPlainText((await repository.getById(parent.id))!.content)).toBe(PARENT_TEXT)
  })

  it('abandons a revision without touching the entry', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control} — actually never mind')
    await screen.getByRole('button', { name: 'Discard revision' }).click()

    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
    expect(await repository.listRevisions(parent.id)).toEqual([])

    // Discarding is fire-and-forget from the click alone; wait for it to actually reach the
    // draft store before the test ends, or its in-flight write can outlive this test's own
    // isolated database.
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
  })

  it('navigates to a dedicated screen to add a connection', async () => {
    const source = await repository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )

    const router = createTestRouter()
    await router.push('/')
    await router.isReady()
    const screen = renderComponent(EntryDetailView, {
      props: { id: source.id },
      global: { plugins: [router] },
    })

    await expect.element(screen.getByText('Left my job')).toBeVisible()
    await screen.getByRole('button', { name: 'Add connection' }).click()

    // The composer itself is its own routed view (NewConnectionView.browser.test.ts covers
    // creating one); this only proves the button gets you there.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('new-connection')
      expect(router.currentRoute.value.params.id).toBe(source.id)
    })
  })

  it('renders an entry’s attachments from the media store', async () => {
    const mediaRef = await media.put(
      new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    )
    const parent = await repository.create(
      createEntryInput({ content: PARENT_CONTENT, media_refs: [mediaRef] }),
    )

    const screen = await mountDetail(parent.id)

    const image = screen.getByRole('img', { name: 'Attached image' })
    await expect.element(image).toBeVisible()

    // A blob URL, minted from the media store for this page load. Regex because the id in it is
    // generated by the browser and cannot be written down here.
    await vi.waitFor(() => {
      expect(image.element().getAttribute('src')).toMatch(/^blob:/)
    })
  })
})
