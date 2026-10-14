import { describe, expect, it, vi } from 'vitest'
import DraftsView from '@/views/DraftsView.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

/** Mounts the view behind a real router already at the Drafts page. */
async function mountDrafts() {
  const router = createTestRouter()
  await router.push('/drafts')
  await router.isReady()

  return renderComponent(DraftsView, { global: { plugins: [router] } })
}

describe('DraftsView (browser)', () => {
  it('lists drafts newest first, each with what it would become, when, how it begins, and where it resumes', async () => {
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

    // Where Resume goes is read off each link; landing there is the page's own to prove.
    const rows = [
      ['New entry', '2026-09-05T10:04:00.000Z', 'A thought of its own', '/entries/new?draft=root'],
      [
        'Revision of “The meeting went badly”',
        '2026-09-05T10:03:00.000Z',
        'The meeting went well',
        `/entries/${parent.id}?draft=revision`,
      ],
      [
        'Connection from “The meeting went badly”',
        '2026-09-05T10:02:00.000Z',
        'One led to the other',
        `/entries/${parent.id}/connect?draft=connection`,
      ],
      [
        'Related entry on “The meeting went badly”',
        '2026-09-05T10:01:00.000Z',
        'It was salvaged later',
        `/entries/${parent.id}?draft=related`,
      ],
    ] as const
    for (const [index, [label, touched, preview, resumesAt]] of rows.entries()) {
      const row = screen.getByRole('listitem').nth(index)
      await expect.element(row.getByText(label)).toBeVisible()
      await expect.element(row.getByText(formatDate(touched))).toBeVisible()
      await expect.element(row.getByText(preview)).toBeVisible()
      await expect
        .element(row.getByRole('link', { name: 'Resume' }))
        .toHaveAttribute('href', resumesAt)
    }
  })

  it('names the entry a draft is on as it is called now, after a revision renamed it', async () => {
    const parent = await entryRepository.create(
      createEntryInput({ content: textContent('The meeting went badly'), title: 'Monday' }),
    )
    const other = await entryRepository.create(
      createEntryInput({ content: textContent('Started the degree') }),
    )
    await entryRepository.create(
      createEntryInput({
        content: parent.content,
        title: 'The Monday meeting',
        parent_id: parent.id,
        relation_type: 'revision',
        revision_mode: 'direct',
        base_version_id: parent.id,
      }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('connection', {
        entry: { content: textContent('One led to the other'), events: TYPED },
        kind: { kind: 'new_connection', parent_id: parent.id, target_id: other.id },
      }),
    )

    const screen = await mountDrafts()

    await expect.element(screen.getByText('Connection from “The Monday meeting”')).toBeVisible()
  })

  it('discards the draft it is asked to, leaving the rest listed', async () => {
    await seedDraft(
      draftRepository,
      makeDraft('kept', {
        entry: { content: textContent('Keep writing this'), events: TYPED },
        updatedAt: '2026-09-05T10:02:00.000Z',
      }),
    )
    await seedDraft(
      draftRepository,
      makeDraft('discarded', {
        entry: { content: textContent('Never mind'), events: TYPED },
        updatedAt: '2026-09-05T10:01:00.000Z',
      }),
    )

    const screen = await mountDrafts()
    await expect.element(screen.getByText('Never mind')).toBeVisible()

    await screen.getByRole('listitem').nth(1).getByRole('button', { name: 'Discard' }).click()

    // The list is reread from disk after a discard, so the row going is the delete landing.
    await expect.element(screen.getByText('Never mind')).not.toBeInTheDocument()
    await expect.element(screen.getByText('Keep writing this')).toBeVisible()
  })

  it('says so plainly when there is nothing in progress', async () => {
    const screen = await mountDrafts()

    await expect.element(screen.getByText('No drafts in progress.')).toBeVisible()
  })

  it('says why when the drafts can’t be read', async () => {
    vi.spyOn(draftRepository, 'list').mockRejectedValue(new Error('list rejected'))

    const screen = await mountDrafts()

    await expect
      .element(screen.getByRole('alert').and(screen.getByText('list rejected', { exact: true })))
      .toBeVisible()
  })
})
