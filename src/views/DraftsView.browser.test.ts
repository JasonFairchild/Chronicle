import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import DraftsView from '@/views/DraftsView.vue'
import { docToPlainText, plainTextDocument, serializeDocument } from '@/domain/entryDocument'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { renderComponent } from '@/testing/renderComponent'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import type { Draft } from '@/types/draft'
import { createEntryInput } from '@/types/entry'

function makeDraft(overrides: Partial<Draft> & Pick<Draft, 'session_id'>): Draft {
  return {
    target: { kind: 'new_root' },
    started_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:02.000Z',
    content: '',
    anchors: [],
    steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'replace' } }],
    ticks: [],
    ...overrides,
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
        content: serializeDocument(plainTextDocument('Half a thought', 'Lake Tahoe')),
      }),
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
    const parent = await entries.create(createEntryInput({ content: 'The meeting went badly' }))
    await drafts.save(
      makeDraft({
        session_id: 'session-1',
        target: { kind: 'new_child', parent_id: parent.id, relation_type: 'update' },
        content: 'It was salvaged later',
      }),
    )

    const screen = mountDrafts()

    await expect.element(screen.getByText('Update on “The meeting went badly”')).toBeVisible()
  })

  it('discards a draft on request, the one thing that removes work', async () => {
    await drafts.save(makeDraft({ session_id: 'session-1', content: 'Never mind' }))

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
