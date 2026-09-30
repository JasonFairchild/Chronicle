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
import { createEntryInput } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView (browser)', () => {
  let drafts: DraftRepository
  let entries: EntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  it('resumes an unsealed session and finishes it as one entry', async () => {
    await seedDraft(
      drafts,
      makeDraft('session-1', {
        entry: { content: textContent('Half a thought'), title: 'Lake Tahoe', events: TYPED },
      }),
    )

    const screen = renderComponent(DraftsView)
    await expect.element(screen.getByText('Half a thought')).toBeVisible()

    await screen.getByRole('button', { name: 'Resume' }).click()
    await screen.getByRole('textbox', { name: 'Draft' }).click()
    await userEvent.keyboard('{Control>}{End}{/Control}, finished at last.')
    await screen.getByRole('button', { name: 'Save as entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listRootEntries()).toHaveLength(1)
    })

    const [saved] = await entries.listRootEntries()
    expect(saved?.title).toBe('Lake Tahoe')
    expect(docToPlainText(saved!.content)).toBe('Half a thought, finished at last.')
    // Sealing writes the entry and deletes the draft in one transaction, so both have landed.
    expect(await drafts.list()).toEqual([])
    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })

  it('names what each draft is attached to rather than only what kind it is', async () => {
    const parent = await entries.create(
      createEntryInput({ content: textContent('The meeting went badly') }),
    )
    await seedDraft(
      drafts,
      makeDraft('session-1', {
        entry: { content: textContent('It was salvaged later'), events: TYPED },
        kind: relatedTo(parent),
      }),
    )

    const screen = renderComponent(DraftsView)

    await expect
      .element(screen.getByText('Related entry on “The meeting went badly”'))
      .toBeVisible()
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
