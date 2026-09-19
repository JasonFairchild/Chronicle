import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import DraftsView from '@/views/DraftsView.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { renderComponent } from '@/testing/renderComponent'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import type { Draft } from '@/types/draft'
import { createEntryInput, emptyEntryDates } from '@/types/entry'

function makeDraft(
  overrides: Partial<Omit<Draft, 'child' | 'parent'>> &
    Pick<Draft, 'session_id'> & {
      content?: string
      parentContent?: string
      parentBaseContent?: string
    },
): Draft {
  const { content, parentContent, parentBaseContent, ...rest } = overrides
  return {
    target: { kind: 'new_root' },
    started_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:02.000Z',
    dates: emptyEntryDates(),
    title: null,
    child: {
      content: content ?? '',
      steps: [{ at: 1_000, step: { stepType: 'replace' } }],
      ticks: [],
    },
    parent:
      parentContent !== undefined
        ? {
            content: parentContent,
            title: null,
            base_content: parentBaseContent ?? parentContent,
            steps: [],
            ticks: [],
          }
        : null,
    ...rest,
  }
}

describe('DraftsView (browser)', () => {
  let drafts: DexieDraftRepository
  let entries: DexieEntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  function mountDrafts() {
    return renderComponent(DraftsView)
  }

  it('resumes an unsealed session and finishes it as one entry', async () => {
    await drafts.save(
      makeDraft({
        session_id: 'session-1',
        content: textContent('Half a thought'),
        title: 'Lake Tahoe',
      }),
      { child: 0, parent: 0 },
    )

    const screen = mountDrafts()
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
    // Sealing writes the entry before it deletes the draft row, so the delete can still be
    // in flight right after the entry appears — wait for it rather than assume it's already done.
    await vi.waitFor(async () => {
      expect(await drafts.list()).toEqual([])
    })
    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })

  it('names what each draft is attached to rather than only what kind it is', async () => {
    const parent = await entries.create(
      createEntryInput({ content: textContent('The meeting went badly') }),
    )
    await drafts.save(
      makeDraft({
        session_id: 'session-1',
        target: { kind: 'new_child', parent_id: parent.id },
        content: textContent('It was salvaged later'),
      }),
      { child: 0, parent: 0 },
    )

    const screen = mountDrafts()

    await expect
      .element(screen.getByText('Related entry on “The meeting went badly”'))
      .toBeVisible()
  })

  it('reopens a related-entry draft on both halves, not the note alone', async () => {
    const parent = await entries.create(
      createEntryInput({ content: textContent('I went to Lake Tahoe with Dad') }),
    )
    await drafts.save(
      makeDraft({
        session_id: 'session-1',
        target: { kind: 'new_child', parent_id: parent.id },
        content: textContent('Wrong lake'),
        // The parent as this session found it, against which "anchor-1 is ours" still reads after
        // the reload — see `anchorsPlacedSince` (`domain/anchors.ts`).
        parentBaseContent: textContent('I went to Lake Tahoe with Dad'),
        parentContent: withAnchorMark(
          'I went to Lake Tahoe with Dad',
          'anchor-1',
          10,
          20,
          'strike',
        ),
      }),
      { child: 0, parent: 0 },
    )

    const screen = mountDrafts()
    await screen.getByRole('button', { name: 'Resume' }).click()

    // An anchor-mode session edits two documents at once, and leaving it is not the same as
    // finishing it: the parent it was marking has to come back with it.
    await expect.element(screen.getByRole('heading', { name: 'This entry' })).toBeVisible()
    await expect
      .element(screen.getByRole('textbox', { name: 'Entry being annotated' }))
      .toBeVisible()
    await expect.element(screen.getByRole('textbox', { name: 'Your note' })).toBeVisible()

    await screen.getByRole('button', { name: 'Add entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listChildren(parent.id)).toHaveLength(1)
    })

    // The anchor placed before the reload is still the one the sealed child refers to.
    const [child] = await entries.listChildren(parent.id)
    expect(child?.anchors[0]?.quote).toBe('Lake Tahoe')
    expect(child?.relation_type).toBe('update')
  })

  it('discards a draft on request, the one thing that removes work', async () => {
    await drafts.save(makeDraft({ session_id: 'session-1', content: textContent('Never mind') }), {
      child: 0,
      parent: 0,
    })

    const screen = mountDrafts()
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('button', { name: 'Discard' }).click()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
    expect(await entries.listRootEntries()).toEqual([])
  })

  it('says so plainly when there is nothing in progress', async () => {
    const screen = mountDrafts()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })
})
