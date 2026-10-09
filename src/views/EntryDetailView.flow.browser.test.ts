import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import App from '@/App.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { selectTextRange } from '@/testing/selectTextRange'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import { createEntryInput } from '@/types/entry'

const PARENT_TEXT = 'I went to Lake Tahoe with Dad'
const PARENT_CONTENT = textContent(PARENT_TEXT)

async function mountApp(path: string) {
  const router = createTestRouter()
  await router.push(path)
  await router.isReady()

  return renderComponent(App, { global: { plugins: [router] } })
}

describe('EntryDetailView flows (browser)', () => {
  it('adds a related entry about the whole entry when nothing is marked, and lands on it', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    await screen.getByRole('textbox', { name: 'Related entry' }).click()
    await userEvent.keyboard('Still think about this trip')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    await expect
      .element(screen.getByRole('article'))
      .toHaveTextContent('Still think about this trip')
    await expect.element(screen.getByText('About', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: PARENT_TEXT }))
      .toHaveAttribute('href', `/entries/${parent.id}`)

    const children = await entryRepository.listChildren(parent.id)
    expect(children[0]?.anchors).toEqual([])
    // Nothing was marked, so the note claims nothing changed about the entry.
    expect(children[0]?.relation_type).toBe('annotation')
  })

  it('keeps a related entry in progress when the reader moves to another entry', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))
    const other = await entryRepository.create(
      createEntryInput({ content: textContent('A different day entirely') }),
    )

    const router = createTestRouter()
    await router.push(`/entries/${parent.id}`)
    await router.isReady()
    const screen = renderComponent(App, { global: { plugins: [router] } })
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    await screen.getByRole('textbox', { name: 'Related entry' }).click()
    await userEvent.keyboard('Half a thought about this')

    // The session has to close — saving after this would seal against the wrong entry — but
    // closing it is not the same as throwing it away.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    // The same page for another entry, as a link or a typed address reaches it.
    await router.push(`/entries/${other.id}`)

    // Resolves once the session's flush has landed.
    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
    await abandonDraft.mock.results[0]!.value
    const [draft] = await draftRepository.list()
    expect(draft).toMatchObject({ kind: 'new_related', parent_id: parent.id })
    expect(docToPlainText(draft!.entry.content)).toBe('Half a thought about this')
  })

  it('frees the entry when the page is left with a revision opened and untouched', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Revise entry' }).click()
    await expect.element(screen.getByRole('textbox', { name: 'Revised entry' })).toBeVisible()

    // Leaving the page, not moving to another entry, is how most sessions end.
    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.getByRole('link', { name: 'Timeline' }).click()
    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
    await abandonDraft.mock.results[0]!.value

    await screen.getByRole('link', { name: PARENT_TEXT }).click()

    await expect.element(screen.getByRole('button', { name: 'Revise entry' })).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Resume draft' }))
      .not.toBeInTheDocument()
  })

  it('anchors a strike to the passage the user selects, in one atomic seal', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    const parentEditor = screen.getByRole('textbox', { name: 'Entry being annotated' })
    await expect.element(parentEditor).toBeVisible()
    parentEditor.element().focus()
    selectTextRange(parentEditor.element(), 10, 20)

    // `exact: true` matters here: this composer's other half (`Related entry`) has its own ordinary
    // "Strikethrough" toggle, and a substring match would find that button instead — on the wrong
    // editor entirely.
    await screen.getByRole('button', { name: 'Strike', exact: true }).click()
    await userEvent.keyboard('D')
    await screen.getByRole('textbox', { name: 'Wording' }).fill('Donner Lake')
    await screen.getByRole('button', { name: 'Accept wording' }).click()

    await screen.getByRole('textbox', { name: 'Related entry' }).click()
    await userEvent.keyboard('Wrong lake')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    // Saving lands on the related entry; what it marked shows on the entry it's about.
    await screen.getByRole('link', { name: PARENT_TEXT }).click()
    await expect
      .element(screen.getByText('Strikes “Lake Tahoe”, replaced with “Donner Lake”'))
      .toBeVisible()

    const revisions = await entryRepository.listRevisions(parent.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.revision_mode).toBe('anchor')

    const children = await entryRepository.listChildren(parent.id)
    expect(children[0]?.anchors).toHaveLength(1)
    expect(children[0]?.anchors[0]?.quote).toBe('Lake Tahoe')
    // Striking reports a correction, so the note reads as an update without anyone being asked.
    expect(children[0]?.relation_type).toBe('update')
  })

  it('pairs a highlight with inline wording, which is what a highlight-plus-comment reads as', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Create related entry' }).click()

    const parentEditor = screen.getByRole('textbox', { name: 'Entry being annotated' })
    await expect.element(parentEditor).toBeVisible()
    parentEditor.element().focus()
    selectTextRange(parentEditor.element(), 10, 20)

    await screen.getByRole('button', { name: 'Highlight' }).click()
    await userEvent.keyboard('D')
    await screen.getByRole('textbox', { name: 'Wording' }).fill('Donner Lake')
    await screen.getByRole('button', { name: 'Accept wording' }).click()

    await screen.getByRole('textbox', { name: 'Related entry' }).click()
    await userEvent.keyboard('Actually')
    await screen.getByRole('button', { name: 'Add entry' }).click()
    await screen.getByRole('link', { name: PARENT_TEXT }).click()

    // A highlight is a mark on existing text, same as a strike, and wording rides along with it the
    // same way — so `relationTypeForAnchors` reads it as an `update`, and `describeAnchor`'s
    // `comment` case has to report the insertion rather than only the passage.
    await expect.element(screen.getByText('On “Lake Tahoe”, adds “Donner Lake”')).toBeVisible()

    const children = await entryRepository.listChildren(parent.id)
    expect(children[0]?.relation_type).toBe('update')
  })

  it('revises an entry by appending a version, leaving the original row untouched', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, or so I remembered it.')
    await screen.getByRole('button', { name: 'Save revision' }).click()

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()

    const revisions = await entryRepository.listRevisions(parent.id)
    expect(docToPlainText(revisions[0]!.content)).toBe(`${PARENT_TEXT}, or so I remembered it.`)
    expect(revisions[0]?.revision_mode).toBe('direct')
    expect(revisions[0]?.authoring_trace?.events.length).toBeGreaterThan(0)
    // The entry itself is never rewritten; the version chain is what carries the change.
    expect(docToPlainText((await entryRepository.getById(parent.id))!.content)).toBe(PARENT_TEXT)
  })

  it('saves a revision that only changes formatting', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}a{/Control}')
    await screen.getByRole('button', { name: 'Bold' }).click()
    await screen.getByRole('button', { name: 'Save revision' }).click()

    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
    const [revision] = await entryRepository.listRevisions(parent.id)
    expect(docToPlainText(revision!.content)).toBe(PARENT_TEXT)
    expect(revision!.content).toContain('"bold"')
  })

  it('discards a revision on request, leaving the entry untouched', async () => {
    const parent = await entryRepository.create(createEntryInput({ content: PARENT_CONTENT }))

    const screen = await mountApp(`/entries/${parent.id}`)
    await screen.getByRole('button', { name: 'Revise entry' }).click()

    await screen.getByRole('textbox', { name: 'Revised entry' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control} — actually never mind')
    // Revise wrote a claim, and Discard waits on that write before deleting: there is always a
    // row to remove.
    const discardDraft = vi.spyOn(useDraftsStore(), 'discardDraft')
    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByText(PARENT_TEXT)).toBeVisible()
    // Resolves once the delete has landed.
    expect(discardDraft).toHaveBeenCalledOnce()
    await discardDraft.mock.results[0]!.value
    expect(await draftRepository.list()).toEqual([])
    expect(await entryRepository.listRevisions(parent.id)).toEqual([])
  })
})
