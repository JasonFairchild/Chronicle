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
import { docToPlainText } from '@/domain/entryDocument'
import { createEntryInput } from '@/types/entry'

const PARENT_TEXT = 'I went to Lake Tahoe with Dad'

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
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
  })

  it('shows a child entry separately rather than spliced into the parent', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))
    await repository.create(
      createEntryInput({
        content: 'It was actually Donner Lake',
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
        content: 'Wrong lake',
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
        content: 'Wrong lake',
        parent_id: parent.id,
        relation_type: 'update',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )
    await repository.create(
      createEntryInput({
        content: 'I stayed home that summer',
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'text',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText('Was attached to: “Lake Tahoe”')).toBeVisible()
  })

  it('reports the version position once an entry has been revised', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))
    await repository.create(
      createEntryInput({
        content: 'I went to Donner Lake with Dad',
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'text',
      }),
    )

    const screen = await mountDetail(parent.id)

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
    await expect.element(screen.getByText('I went to Donner Lake with Dad')).toBeVisible()
  })

  it('shows an incoming connection on the entry it points at', async () => {
    const target = await repository.create(createEntryInput({ content: 'Started the degree' }))
    const source = await repository.create(createEntryInput({ content: 'Left my job' }))
    await repository.create(
      createEntryInput({
        content: 'One made the other possible',
        parent_id: source.id,
        target_id: target.id,
        relation_type: 'connection',
        metadata: { connection_label: 'led_to' },
      }),
    )

    const screen = await mountDetail(target.id)

    await expect.element(screen.getByRole('link', { name: 'led_to' })).toBeVisible()
  })

  it('reports a missing entry instead of failing silently', async () => {
    const screen = await mountDetail('does-not-exist')

    await expect.element(screen.getByText('Entry not found.')).toBeVisible()
  })

  it('adds an unanchored note about the entry as a whole', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))

    const screen = await mountDetail(parent.id)
    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()

    await screen.getByLabelText('Your note').fill('Still think about this trip')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    await expect.element(screen.getByText('Still think about this trip')).toBeVisible()

    const children = await repository.listChildren(parent.id)
    expect(children[0]?.anchors).toEqual([])
  })

  it('anchors a strike to the passage the user selects, in one atomic seal', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Anchor an update to a passage' }).click()

    const parentEditor = screen.getByRole('textbox', { name: 'Entry being annotated' })
    await expect.element(parentEditor).toBeVisible()
    selectTextRange(parentEditor.element(), 10, 20)

    await screen.getByRole('button', { name: 'Strike selection' }).click()
    await expect.element(screen.getByLabelText('Replacement wording')).toBeVisible()

    await screen.getByLabelText('Replacement wording').fill('Donner Lake')
    await screen.getByRole('button', { name: 'Insert' }).click()

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
  })

  it('warns before saving a revision that changes the text under an anchor', async () => {
    const marked = withAnchorMark(PARENT_TEXT, 'anchor-1', 10, 20, 'comment')
    const parent = await repository.create(createEntryInput({ content: marked }))
    await repository.create(
      createEntryInput({
        content: 'Wonderful trip',
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise' }).click()

    const editorLocator = screen.getByRole('textbox', { name: 'Revised entry' })
    await expect.element(editorLocator).toBeVisible()
    const editorEl = editorLocator.element()
    editorEl.focus()
    selectTextRange(editorEl, 10, 20)
    await userEvent.keyboard('{Backspace}')

    // The full sentence, not just that some warning fired: PRODUCT.md §5.3 requires naming the
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
        content: 'Wonderful trip',
        parent_id: parent.id,
        relation_type: 'annotation',
        anchors: [{ anchor_id: 'anchor-1', quote: 'Lake Tahoe' }],
      }),
    )

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}!')

    expect(screen.getByText(/This changes the passage/).query()).toBeNull()

    await screen.getByRole('button', { name: 'Discard revision' }).click()
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
  })

  it('revises an entry by appending a version, leaving the original row untouched', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, or so I remembered it.')
    await screen.getByRole('button', { name: 'Save revision' }).click()

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()

    const revisions = await repository.listRevisions(parent.id)
    expect(docToPlainText(revisions[0]!.content)).toBe(`${PARENT_TEXT}, or so I remembered it.`)
    expect(revisions[0]?.revision_mode).toBe('text')
    expect(revisions[0]?.authoring_trace?.steps.length).toBeGreaterThan(0)
    // The entry itself is never rewritten; the version chain is what carries the change.
    expect((await repository.getById(parent.id))?.content).toBe(PARENT_TEXT)
  })

  it('abandons a revision without touching the entry', async () => {
    const parent = await repository.create(createEntryInput({ content: PARENT_TEXT }))

    const screen = await mountDetail(parent.id)
    await screen.getByRole('button', { name: 'Revise' }).click()

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

  it('creates an outgoing connection to another entry', async () => {
    const source = await repository.create(createEntryInput({ content: 'Left my job' }))
    const destination = await repository.create(createEntryInput({ content: 'Started the degree' }))

    const screen = await mountDetail(source.id)
    await expect.element(screen.getByText('Left my job')).toBeVisible()

    await screen.getByLabelText('Connect to').selectOptions(destination.id)
    await screen.getByLabelText('How they relate').fill('led_to')
    await screen.getByLabelText('Why they relate').fill('One made the other possible')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    await expect.element(screen.getByRole('link', { name: 'led_to' })).toBeVisible()

    await vi.waitFor(async () => {
      const connections = await repository.listConnectionsFor(source.id)
      expect(connections[0]?.target_id).toBe(destination.id)
    })
  })

  it('renders an entry’s attachments from the media store', async () => {
    const mediaRef = await media.put(
      new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    )
    const parent = await repository.create(
      createEntryInput({ content: PARENT_TEXT, media_refs: [mediaRef] }),
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
