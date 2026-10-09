import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import EntryDetailView from '@/views/EntryDetailView.vue'
import { draftRepository, entryRepository, mediaRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { useEntriesStore } from '@/stores/entriesStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { selectTextRange } from '@/testing/selectTextRange'
import { textContent } from '@/domain/entryDocument'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate, formatDateline, formatTime } from '@/utils/format'

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
  it('renders the entry’s own text', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
  })

  it('heads an untitled entry with the day it was written, and its time below', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)

    await expect
      .element(screen.getByRole('heading', { name: formatDateline(parent.created_at) }))
      .toBeVisible()
    await expect
      .element(screen.getByText(`Created at ${formatTime(parent.created_at)}`, { exact: true }))
      .toBeVisible()
  })

  it('shows the title once, as the page’s heading', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: PARENT_CONTENT, title: 'The Tahoe trip' }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByRole('heading', { name: 'The Tahoe trip' })).toBeVisible()
    expect(screen.getByText('The Tahoe trip', { exact: true }).elements()).toHaveLength(1)
  })

  it('shows a related entry separately rather than spliced into the parent', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    await entryRepository.create(
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

  it('describes which passage an anchored related entry is about', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'strike')
    const parent = await entryRepository.create(createEntryInput({ content: marked }))
    await entryRepository.create(
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
    const parent = await entryRepository.create(createEntryInput({ content: marked }))
    await entryRepository.create(
      createEntryInput({
        content: textContent('Wrong lake'),
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )
    await entryRepository.create(
      createEntryInput({
        content: textContent('I stayed home that summer'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
        base_version_id: parent.id,
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText('Was attached to: “Lake Tahoe”')).toBeVisible()
  })

  it('reports the version position once an entry has been revised', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    await entryRepository.create(
      createEntryInput({
        content: textContent('I went to Donner Lake with Dad'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
        base_version_id: parent.id,
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
    await expect.element(screen.getByText('I went to Donner Lake with Dad')).toBeVisible()
  })

  it('shows an incoming connection on the entry it points at', async () => {
    const target = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    await entryRepository.create(
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

  it('shows a related entry card’s created date', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    const related = await entryRepository.create(
      createEntryInput({
        content: textContent('It was actually Donner Lake'),
        parent_id: parent.id,
        relation_type: 'update',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(formatDate(related.created_at))).toBeVisible()
  })

  it('opens the connection’s own page, not the far endpoint, when its card is clicked', async () => {
    const target = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const connection = await entryRepository.create(
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

  it('shows a breadcrumb back to the parent on a related entry’s own detail page', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job'), title: 'Career change' }),
    )
    const related = await entryRepository.create(
      createEntryInput({
        content: textContent('Started the degree'),
        parent_id: parent.id,
        relation_type: 'update',
      }),
    )

    const screen = await mountDetail(related.id)

    await expect.element(screen.getByText('About')).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: 'Career change' }))
      .toHaveAttribute('href', `/entries/${parent.id}`)
  })

  it('shows a breadcrumb linking both sides on a connection’s own detail page', async () => {
    const target = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    const source = await entryRepository.create(
      createEntryInput({ content: textContent('Left my job') }),
    )
    const connection = await entryRepository.create(
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

  it('shows the details the writer gave, alongside when the entry was created', async () => {
    const parent = await entryRepository.create(
      createEntryInput({
        content: PARENT_CONTENT,
        dates: {
          ...emptyEntryDates(),
          occurred_at: '1994-06-11',
          occurred_time_note: 'late morning',
          recorded_at: '1994-06-12',
        },
        location: 'home',
        original_medium: 'paper journal',
        original_medium_note: 'blue Moleskine',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(/Happened .*1994 · late morning/)).toBeVisible()
    await expect.element(screen.getByText('Where: home', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(/Originally written .*1994/)).toBeVisible()
    await expect
      .element(screen.getByText('Written in paper journal · blue Moleskine', { exact: true }))
      .toBeVisible()
  })

  it('says why a related entry that says nothing can’t be added', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    // Typed into and then emptied: the document is no longer the blank one the session opened
    // with, but it still holds nothing worth keeping.
    await screen.getByRole('textbox', { name: 'Related entry' }).click()
    await userEvent.keyboard('x{Backspace}')

    await screen.getByRole('button', { name: 'Add entry' }).click()
    await expect
      .element(
        screen.getByRole('alert').and(
          screen.getByText('Write something in the entry first. A title alone can’t be saved.', {
            exact: true,
          }),
        ),
      )
      .toBeVisible()

    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
  })

  it('offers the draft already in progress on an entry rather than a second one', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    const other = await entryRepository.create(
      createEntryInput({ content: textContent('A different day entirely') }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()
    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, and Mom')

    // Left, not discarded: the draft stays outstanding against this entry.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.rerender({ id: other.id })
    expect(abandonDraft).toHaveBeenCalledOnce()
    await abandonDraft.mock.results[0]!.value
    await screen.rerender({ id: parent.id })

    // Two drafts on one version would branch it, so neither way in starts another.
    await expect.element(screen.getByRole('button', { name: 'Resume draft' })).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Revise entry' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Create related entry' }))
      .not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Resume draft' }).click()
    await expect
      .element(screen.getByRole('textbox', { name: 'Revised entry' }))
      .toHaveTextContent(`${PARENT_TEXT}, and Mom`)
  })

  it('frees the entry when a revision is opened and left untouched', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    const other = await entryRepository.create(
      createEntryInput({ content: textContent('A different day entirely') }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()
    await expect.element(screen.getByRole('textbox', { name: 'Revised entry' })).toBeVisible()

    // Opening Revise claims the entry at once; leaving with nothing typed gives the claim up.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.rerender({ id: other.id })
    expect(abandonDraft).toHaveBeenCalledOnce()
    await abandonDraft.mock.results[0]!.value
    await screen.rerender({ id: parent.id })

    await expect.element(screen.getByRole('button', { name: 'Revise entry' })).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Resume draft' }))
      .not.toBeInTheDocument()
  })

  it('shows the version another tab saved once this tab is returned to', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    const screen = await mountDetail(parent.id)
    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()

    // Saved in another tab while this one sat in the background.
    await entryRepository.create(
      createEntryInput({
        content: textContent('I went to Donner Lake with Dad'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
        base_version_id: parent.id,
      }),
    )
    window.dispatchEvent(new Event('focus'))

    await expect.element(screen.getByText('I went to Donner Lake with Dad')).toBeVisible()
    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
  })

  it('offers the draft another tab has only just opened on an entry, before a word is typed', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    // Another tab: its own stores over the same database, where Revise was clicked and nothing
    // typed yet.
    setActivePinia(createPinia())
    const aggregated = await useEntriesStore().getAggregatedEntry(parent.id)
    const save = vi.spyOn(draftRepository, 'save')
    useDraftsStore().beginDraft({ kind: 'revision', parent: aggregated! })

    // Beginning alone writes the claim; waiting on that write, not a flush of our own, proves it.
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    await save.mock.results[0]!.value

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByRole('button', { name: 'Resume draft' })).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Revise entry' }))
      .not.toBeInTheDocument()
  })

  it('shows the parent’s own title in the anchor-mode composer, not just its body', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: PARENT_CONTENT, title: 'The Tahoe trip' }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    // The page heading carries the parent's title too, so this looks only inside the composer's
    // own half, which shows a title only because the session reads `parentTitle` off the entry.
    await expect
      .element(screen.getByRole('region', { name: 'This entry' }).getByText('The Tahoe trip'))
      .toBeVisible()
  })

  it('warns before saving a revision that changes the text under an anchor', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await entryRepository.create(createEntryInput({ content: marked }))
    await entryRepository.create(
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

    // Neither assertion above completes the session, and the draft's scheduled flush would
    // otherwise still be pending when this test ends — closing it here keeps that write from
    // landing in whichever repository the next test's `beforeEach` happens to have installed by
    // the time a stray timer fires.
    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
  })

  it('stays quiet when a revision only moves an anchor, not the text it covers', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await entryRepository.create(createEntryInput({ content: marked }))
    await entryRepository.create(
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

    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
  })

  it('stays quiet when a revision types right up against either edge of an anchor', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await entryRepository.create(createEntryInput({ content: marked }))
    await entryRepository.create(
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
    selectTextRange(editorEl, 10, 10)
    await userEvent.keyboard('(')
    selectTextRange(editorEl, 21, 21)
    await userEvent.keyboard(')')

    await expect.element(editorLocator).toHaveTextContent('I went to (Lake Tahoe) with Dad')
    expect(screen.getByText(/This changes the passage/).query()).toBeNull()

    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
  })

  it('warns when a paste swaps text under an anchor for text of the same length', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await entryRepository.create(createEntryInput({ content: marked }))
    await entryRepository.create(
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
    selectTextRange(editorEl, 12, 14)
    // A hand-built paste, as in `DocumentEditor.browser.test.ts`: neither runner has a real one.
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', 'ne')
    editorEl.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }),
    )

    await expect.element(editorLocator).toHaveTextContent('I went to Lane Tahoe with Dad')
    await expect
      .element(screen.getByText('This changes the passage Wonderful trip is about.'))
      .toBeVisible()

    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
  })

  it('revises one detail, leaving the others and the text as they were', async () => {
    const parent = await entryRepository.create(
      createEntryInput({
        content: PARENT_CONTENT,
        dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
        location: 'home',
        original_medium: 'paper journal',
      }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByLabelText('Where', { exact: true }).fill('the cabin')
    await screen.getByRole('button', { name: 'Save revision' }).click()

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
    await expect.element(screen.getByText('Where: the cabin', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(/Happened .*1994/)).toBeVisible()
    await expect
      .element(screen.getByText('Written in paper journal', { exact: true }))
      .toBeVisible()
    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
  })

  it('refuses a revision that changes nothing, and says so', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise entry' }).click()
    await screen.getByRole('button', { name: 'Save revision' }).click()

    await expect
      .element(
        screen.getByRole('alert').and(screen.getByText('No changes to save', { exact: true })),
      )
      .toBeVisible()
  })

  it('navigates to a dedicated screen to add a connection', async () => {
    const source = await entryRepository.create(
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

    // The composer itself is its own routed view (NewConnectionView.flow.browser.test.ts covers
    // creating one); this only proves the button gets you there.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('new-connection')
      expect(router.currentRoute.value.params.id).toBe(source.id)
    })
  })

  it('renders an entry’s attachments from the media store', async () => {
    const mediaRef = await mediaRepository.put(
      new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    )
    const parent = await entryRepository.create(
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
