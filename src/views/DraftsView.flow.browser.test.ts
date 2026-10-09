import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import App from '@/App.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, emptyEntryDates } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts the app behind a real router already at the Drafts page. */
async function mountApp() {
  const router = createTestRouter()
  await router.push('/drafts')
  await router.isReady()

  return renderComponent(App, { global: { plugins: [router] } })
}

describe('DraftsView flows (browser)', () => {
  it('resumes a draft with its words, title and dates, and lands on the entry it becomes', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', {
        entry: {
          content: textContent('Half a thought'),
          title: 'Lake Tahoe',
          dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
          events: TYPED,
        },
      }),
    )

    const screen = await mountApp()
    await expect.element(screen.getByText('Half a thought')).toBeVisible()

    await screen.getByRole('button', { name: 'Resume' }).click()
    // Exact, or "Happened" would also match the "Time it happened" beside it.
    await expect
      .element(screen.getByLabelText('Happened', { exact: true }))
      .toHaveValue('1994-06-11')
    await screen.getByRole('textbox', { name: 'Draft' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, finished at last.')
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    await expect.element(screen.getByRole('heading', { name: 'Lake Tahoe' })).toBeVisible()
    await expect
      .element(screen.getByRole('article'))
      .toHaveTextContent('Half a thought, finished at last.')
    await expect.element(screen.getByText(/Happened .*1994/)).toBeVisible()
    // Sealing writes the entry and deletes the draft in one transaction, so both have landed.
    expect(await draftRepository.list()).toEqual([])
  })

  it('saves a revision from its draft and lands on the entry it revised', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('The first go') }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('session-1', {
        entry: {
          base_version_id: parent.id,
          base_content: parent.content,
          content: textContent('The first go, reworded'),
          events: TYPED,
        },
        kind: { kind: 'revision', parent_id: parent.id },
      }),
    )

    const screen = await mountApp()
    await screen.getByRole('button', { name: 'Resume' }).click()
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    // A revision is a version of the entry, not a page of its own.
    await expect.element(screen.getByText(/Version 2 of 2/)).toBeVisible()
    await expect.element(screen.getByRole('article')).toHaveTextContent('The first go, reworded')
  })

  it('reopens a related-entry draft on both halves, not the related entry alone', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('I went to Lake Tahoe with Dad') }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('session-1', {
        entry: { content: textContent('Wrong lake'), events: TYPED },
        // The parent as this session found it, against which "anchor-1 is ours" still reads after
        // the reload — see `anchorsPlacedSince` (`domain/anchors.ts`).
        kind: relatedTo(parent, {
          content: withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20, 'strike'),
        }),
      }),
    )

    const screen = await mountApp()
    await screen.getByRole('button', { name: 'Resume' }).click()

    // An anchor-mode session edits two documents at once, and leaving it is not the same as
    // finishing it: the parent it was marking has to come back with it.
    await expect.element(screen.getByRole('heading', { name: 'This entry' })).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Entry being annotated' }))
      .toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: 'Related entry' })).toBeVisible()

    await screen.getByRole('button', { name: 'Add entry' }).click()

    // Lands on the related entry once the save has landed. The anchor placed before the reload is
    // still the one it refers to.
    await expect
      .element(screen.getByRole('link', { name: 'I went to Lake Tahoe with Dad' }))
      .toBeVisible()
    const children = await entryRepository.listChildren(parent.id)
    expect(children).toHaveLength(1)
    const [related] = children
    expect(related?.anchors[0]?.quote).toBe('Lake Tahoe')
    expect(related?.relation_type).toBe('update')
  })

  it('discards a draft on request, the one thing that removes work', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
    )

    const screen = await mountApp()
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
    expect(await entryRepository.listRootEntries()).toEqual([])
  })

  it('refuses a draft on a version since replaced, says why, and keeps it', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('The first go') }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('session-1', {
        entry: {
          base_version_id: parent.id,
          base_content: parent.content,
          content: textContent('The first go, reworded'),
          events: TYPED,
        },
        kind: { kind: 'revision', parent_id: parent.id },
      }),
    )
    // Saved elsewhere after the draft began, so the draft no longer follows the latest version.
    await entryRepository.create(
      createEntryInput({
        content: textContent('The second go'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
        base_version_id: parent.id,
      }),
    )

    const screen = await mountApp()
    await screen.getByRole('button', { name: 'Resume' }).click()
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    await expect
      .element(
        screen
          .getByRole('status')
          .and(
            screen.getByText(
              'This entry was revised after this draft began, so saving this would overwrite ' +
                'that version. Copy what you need, then discard it.',
              { exact: true },
            ),
          ),
      )
      .toBeVisible()
    expect(await entryRepository.listRevisions(parent.id)).toHaveLength(1)
    expect(await draftRepository.list()).toHaveLength(1)
  })

  it('lets go of an untouched claim when the page is left', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('The first go') }),
    )
    // A revision nobody has typed in yet: its words are still the entry's own.
    await seedDraft(
      draftRepository,
      makeDraft('session-1', {
        entry: {
          base_version_id: parent.id,
          base_content: parent.content,
          content: parent.content,
        },
        kind: { kind: 'revision', parent_id: parent.id },
      }),
    )

    const screen = await mountApp()
    await screen.getByRole('button', { name: 'Resume' }).click()
    await expect.element(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible()

    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    await screen.getByRole('link', { name: 'Timeline' }).click()
    await vi.waitFor(() => expect(abandonDraft).toHaveBeenCalledOnce())
    await abandonDraft.mock.results[0]!.value

    await screen.getByRole('link', { name: 'Drafts' }).click()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })
})
