import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import DraftsView from '@/views/DraftsView.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts the view behind a real router already at the Drafts page. */
async function mountDrafts(router = createTestRouter()) {
  await router.push('/drafts')
  await router.isReady()

  return renderComponent(DraftsView, { global: { plugins: [router] } })
}

describe('DraftsView (browser)', () => {
  it('lists drafts newest first, each with what it would become, when, and how it begins', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('The meeting went badly') }),
    )
    const other = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    // Seeded out of order, so the order shown is the list's own.
    await seedDraft(
      draftRepository,
      makeDraft('related', {
        entry: { content: textContent('It was salvaged later'), events: TYPED },
        kind: relatedTo(parent),
        updatedAt: '2026-09-05T10:01:00.000Z',
      }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('root', {
        entry: { content: textContent('A thought of its own'), events: TYPED },
        updatedAt: '2026-09-05T10:04:00.000Z',
      }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('connection', {
        entry: { content: textContent('One led to the other'), events: TYPED },
        kind: { kind: 'new_connection', parent_id: parent.id, target_id: other.id },
        updatedAt: '2026-09-05T10:02:00.000Z',
      }),
    )
    await seedDraft(
      draftRepository,
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

    const screen = await mountDrafts()

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

  it('discards a listed draft while another is open, leaving the open one as it was', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('open', {
        entry: { content: textContent('Keep writing this'), events: TYPED },
        updatedAt: '2026-09-05T10:02:00.000Z',
      }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('listed', {
        entry: { content: textContent('Never mind'), events: TYPED },
        updatedAt: '2026-09-05T10:01:00.000Z',
      }),
    )

    const screen = await mountDrafts()
    await screen.getByRole('listitem').nth(0).getByRole('button', { name: 'Resume' }).click()
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('listitem').nth(1).getByRole('button', { name: 'Discard' }).click()

    // The list is reread from disk after a discard, so the row going is the delete landing.
    await expect.element(screen.getByText('Never mind')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Keep writing this')
  })

  it('keeps the version another tab saved first, and shows what this one had to copy', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('session-1', { entry: { content: textContent('Half a thought'), events: TYPED } }),
    )
    const screen = await mountDrafts()
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
    await seedDraft(draftRepository, {
      ...makeDraft('session-1', {
        entry: { content: textContent(text), title: 'Lake Tahoe', events: TYPED },
      }),
      started_at: 'not a timestamp',
    })

    const screen = await mountDrafts()
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
    const screen = await mountDrafts()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })

  it('says why when the drafts can’t be read', async () => {
    vi.spyOn(draftRepository, 'list').mockRejectedValue(new Error('Storage is unavailable'))

    const screen = await mountDrafts()

    await expect
      .element(
        screen.getByRole('alert').and(screen.getByText('Storage is unavailable', { exact: true })),
      )
      .toBeVisible()
  })

  it('reopens a draft with its words, title and dates', async () => {
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

    const screen = await mountDrafts()
    await screen.getByRole('button', { name: 'Resume' }).click()

    await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lake Tahoe')
    await expect
      .element(screen.getByRole('textbox', { name: 'Draft' }))
      .toHaveTextContent('Half a thought')
    // Exact, or "Happened" would also match the "Time it happened" beside it.
    await expect
      .element(screen.getByLabelText('Happened', { exact: true }))
      .toHaveValue('1994-06-11')
  })

  it('lands on the entry a revision revised, not a page of its own', async () => {
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
    const router = createTestRouter()
    const screen = await mountDrafts(router)

    await screen.getByRole('button', { name: 'Resume' }).click()
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    await vi.waitFor(() => {
      expect(router.currentRoute.value).toMatchObject({
        name: 'entry-detail',
        params: { id: parent.id },
      })
    })
  })

  it('refuses a draft on a version since replaced, and says why', async () => {
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

    const screen = await mountDrafts()
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
  })
})
