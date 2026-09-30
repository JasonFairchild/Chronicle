import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import DraftsView from '@/views/DraftsView.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import { renderComponent } from '@/testing/renderComponent'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView (browser)', () => {
  let drafts: DraftRepository
  let entries: EntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  it('resumes a draft with its words, title and dates, and finishes it as one entry', async () => {
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

    const screen = renderComponent(DraftsView)
    await expect.element(screen.getByText('Half a thought')).toBeVisible()

    await screen.getByRole('button', { name: 'Resume' }).click()
    // Exact, or "Happened" would also match the "Time it happened" beside it.
    await expect
      .element(screen.getByLabelText('Happened', { exact: true }))
      .toHaveValue('1994-06-11')
    await screen.getByRole('textbox', { name: 'Draft' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, finished at last.')
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listRootEntries()).toHaveLength(1)
    })

    const [saved] = await entries.listRootEntries()
    expect(saved?.title).toBe('Lake Tahoe')
    expect(saved?.dates.occurred_at).toBe('1994-06-11')
    expect(docToPlainText(saved!.content)).toBe('Half a thought, finished at last.')
    // Sealing writes the entry and deletes the draft in one transaction, so both have landed.
    expect(await drafts.list()).toEqual([])
    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
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

    const screen = renderComponent(DraftsView)

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

    const screen = renderComponent(DraftsView)
    await screen.getByRole('button', { name: 'Resume' }).click()

    // An anchor-mode session edits two documents at once, and leaving it is not the same as
    // finishing it: the parent it was marking has to come back with it.
    await expect.element(screen.getByRole('heading', { name: 'This entry' })).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Entry being annotated' }))
      .toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: 'Related entry' })).toBeVisible()

    await screen.getByRole('button', { name: 'Add entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listChildren(parent.id)).toHaveLength(1)
    })

    // The anchor placed before the reload is still the one the sealed related entry refers to.
    const [related] = await entries.listChildren(parent.id)
    expect(related?.anchors[0]?.quote).toBe('Lake Tahoe')
    expect(related?.relation_type).toBe('update')
  })

  it('discards a draft on request, the one thing that removes work', async () => {
    await seedDraft(
      drafts,
      makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
    )

    const screen = renderComponent(DraftsView)
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

    const screen = renderComponent(DraftsView)
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

    const screen = renderComponent(DraftsView)
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

    const screen = renderComponent(DraftsView)
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
    const screen = renderComponent(DraftsView)

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })
})
