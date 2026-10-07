import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import DraftsView from '@/views/DraftsView.vue'
import { textContent } from '@/domain/entryDocument'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts `component` behind a real router already at the Drafts page. */
async function mountAt(component: typeof App | typeof DraftsView) {
  const router = createTestRouter()
  await router.push('/drafts')
  await router.isReady()

  return renderComponent(component, { global: { plugins: [router] } })
}

describe('DraftsView (browser)', () => {
  let drafts: DraftRepository
  let entries: EntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  it('resumes a draft with its words, title and dates, and lands on the entry it becomes', async () => {
    await seedDraft(
      drafts,
      makeDraft('session-1', {
        entry: {
          content: textContent('Half a thought'),
          title: 'Lake Tahoe',
          dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
          events: TYPED,
        },
      }),
    )

    const screen = await mountAt(App)
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
      .element(screen.getByRole('textbox', { name: 'Entry content' }))
      .toHaveTextContent('Half a thought, finished at last.')
    await expect.element(screen.getByText(/Happened .*1994/)).toBeVisible()
    // Sealing writes the entry and deletes the draft in one transaction, so both have landed.
    expect(await drafts.list()).toEqual([])
  })

  it('saves a revision from its draft and lands on the entry it revised', async () => {
    const parent = await entries.create(createEntryInput({ content: textContent('The first go') }))
    await seedDraft(
      drafts,
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

    const screen = await mountAt(App)
    await screen.getByRole('button', { name: 'Resume' }).click()
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    // A revision is a version of the entry, not a page of its own.
    await expect.element(screen.getByText('Version 2 of 2', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Entry content' }))
      .toHaveTextContent('The first go, reworded')
  })

  it('lists drafts newest first, each with what it would become, when, and how it begins', async () => {
    const parent = await entries.create(
      createEntryInput({ content: textContent('The meeting went badly') }),
    )
    const other = await entries.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    // Seeded out of order, so the order shown is the list's own.
    await seedDraft(
      drafts,
      makeDraft('related', {
        entry: { content: textContent('It was salvaged later'), events: TYPED },
        kind: relatedTo(parent),
        updatedAt: '2026-09-05T10:01:00.000Z',
      }),
    )
    await seedDraft(
      drafts,
      makeDraft('root', {
        entry: { content: textContent('A thought of its own'), events: TYPED },
        updatedAt: '2026-09-05T10:04:00.000Z',
      }),
    )
    await seedDraft(
      drafts,
      makeDraft('connection', {
        entry: { content: textContent('One led to the other'), events: TYPED },
        kind: { kind: 'new_connection', parent_id: parent.id, target_id: other.id },
        updatedAt: '2026-09-05T10:02:00.000Z',
      }),
    )
    await seedDraft(
      drafts,
      makeDraft('revision', {
        entry: {
          base_version_id: parent.id,
          base_content: parent.content,
          content: textContent('The meeting went well'),
          events: TYPED,
        },
        kind: { kind: 'revision', parent_id: parent.id },
        updatedAt: '2026-09-05T10:03:00.000Z',
      }),
    )

    const screen = await mountAt(DraftsView)

    const rows = [
      ['New entry', '2026-09-05T10:04:00.000Z', 'A thought of its own'],
      ['Revision of “The meeting went badly”', '2026-09-05T10:03:00.000Z', 'The meeting went well'],
      [
        'Connection from “The meeting went badly”',
        '2026-09-05T10:02:00.000Z',
        'One led to the other',
      ],
      [
        'Related entry on “The meeting went badly”',
        '2026-09-05T10:01:00.000Z',
        'It was salvaged later',
      ],
    ] as const
    for (const [index, [label, touched, preview]] of rows.entries()) {
      const row = screen.getByRole('listitem').nth(index)
      await expect.element(row.getByText(label)).toBeVisible()
      await expect.element(row.getByText(formatDate(touched))).toBeVisible()
      await expect.element(row.getByText(preview)).toBeVisible()
    }
  })

  it('reopens a related-entry draft on both halves, not the related entry alone', async () => {
    const parent = await entries.create(
      createEntryInput({ content: textContent('I went to Lake Tahoe with Dad') }),
    )
    await seedDraft(
      drafts,
      makeDraft('session-1', {
        entry: { content: textContent('Wrong lake'), events: TYPED },
        // The parent as this session found it, against which "anchor-1 is ours" still reads after
        // the reload — see `anchorsPlacedSince` (`domain/anchors.ts`).
        kind: relatedTo(parent, {
          content: withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20, 'strike'),
        }),
      }),
    )

    const screen = await mountAt(App)
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
    const children = await entries.listChildren(parent.id)
    expect(children).toHaveLength(1)
    const [related] = children
    expect(related?.anchors[0]?.quote).toBe('Lake Tahoe')
    expect(related?.relation_type).toBe('update')
  })

  it('discards a draft on request, the one thing that removes work', async () => {
    await seedDraft(
      drafts,
      makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
    )

    const screen = await mountAt(DraftsView)
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
    expect(await entries.listRootEntries()).toEqual([])
  })

  it('discards a listed draft while another is open, leaving the open one as it was', async () => {
    await seedDraft(
      drafts,
      makeDraft('open', {
        entry: { content: textContent('Keep writing this'), events: TYPED },
        updatedAt: '2026-09-05T10:02:00.000Z',
      }),
    )
    await seedDraft(
      drafts,
      makeDraft('listed', {
        entry: { content: textContent('Never mind'), events: TYPED },
        updatedAt: '2026-09-05T10:01:00.000Z',
      }),
    )

    const screen = await mountAt(DraftsView)
    await screen.getByRole('listitem').nth(0).getByRole('button', { name: 'Resume' }).click()
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('listitem').nth(1).getByRole('button', { name: 'Discard' }).click()

    // The list is reread from disk after a discard, so the row going is the delete landing.
    await expect.element(screen.getByText('Never mind')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Keep writing this')
  })

  it('refuses a draft on a version since replaced, says why, and keeps it', async () => {
    const parent = await entries.create(createEntryInput({ content: textContent('The first go') }))
    await seedDraft(
      drafts,
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
    await entries.create(
      createEntryInput({
        content: textContent('The second go'),
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
        base_version_id: parent.id,
      }),
    )

    const screen = await mountAt(DraftsView)
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
    expect(await entries.listRevisions(parent.id)).toHaveLength(1)
    expect(await drafts.list()).toHaveLength(1)
  })

  it('lets go of an untouched claim when the page is left', async () => {
    const parent = await entries.create(createEntryInput({ content: textContent('The first go') }))
    // A revision nobody has typed in yet: its words are still the entry's own.
    await seedDraft(
      drafts,
      makeDraft('session-1', {
        entry: {
          base_version_id: parent.id,
          base_content: parent.content,
          content: parent.content,
        },
        kind: { kind: 'revision', parent_id: parent.id },
      }),
    )

    const screen = await mountAt(DraftsView)
    await screen.getByRole('button', { name: 'Resume' }).click()
    await expect.element(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible()

    const abandonDraft = vi.spyOn(useDraftsStore(), 'abandonDraft')
    screen.unmount()
    expect(abandonDraft).toHaveBeenCalledOnce()
    await abandonDraft.mock.results[0]!.value

    const returned = await mountAt(DraftsView)

    await expect.element(returned.getByText('No drafts in progress.')).toBeVisible()
  })

  it('keeps the version another tab saved first, and shows what this one had to copy', async () => {
    await seedDraft(
      drafts,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountAt(DraftsView)
    await screen.getByRole('button', { name: 'Resume' }).click()
    await expect.element(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible()

    // Another tab, with its own stores over the same database, writes the draft first.
    setActivePinia(createPinia())
    const otherTab = useDraftsStore()
    await otherTab.resumeDraft('session-1')
    otherTab.recordChange('session-1', {
      content: textContent('Half a thought, finished elsewhere'),
      steps: [{ stepType: 'replace' }],
    })
    await otherTab.flush('session-1')

    // This tab hasn't caught up, so its next write lands on a draft that has moved on.
    await screen.getByRole('textbox', { name: 'Draft' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control} here')

    await expect
      .element(
        screen.getByText(
          'This draft was changed elsewhere at the same time, and now shows what was saved ' +
            'there. What you had here is below.',
        ),
      )
      .toBeVisible()
    await expect.element(screen.getByText('Half a thought here')).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Half a thought, finished elsewhere')
  })

  it('shows all of a draft that will not reopen for copying, and still discards it', async () => {
    const text =
      'Everything I meant to say about the lake that summer: the cabin, the dock, the long drive ' +
      'home, and why none of it went the way we planned.'
    await seedDraft(drafts, {
      ...makeDraft('session-1', {
        entry: { content: textContent(text), title: 'Lake Tahoe', events: TYPED },
      }),
      started_at: 'not a timestamp',
    })

    const screen = await mountAt(DraftsView)
    await screen.getByRole('button', { name: 'Resume' }).click()

    await expect
      .element(
        screen
          .getByRole('alert')
          .and(
            screen.getByText(
              'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
              { exact: true },
            ),
          ),
      )
      .toBeVisible()
    await expect.element(screen.getByText('Lake Tahoe')).toBeVisible()
    await expect.element(screen.getByText(text)).toBeVisible()

    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })

  it('says so plainly when there is nothing in progress', async () => {
    const screen = await mountAt(DraftsView)

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })
})
