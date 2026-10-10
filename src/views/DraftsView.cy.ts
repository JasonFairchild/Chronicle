import { createPinia, setActivePinia } from 'pinia'
import DraftsView from '@/views/DraftsView.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createTestRouter } from '@/testing/testRouter'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView', () => {
  it('lists drafts newest first, each with what it would become, when, and how it begins', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

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
    rows.forEach(([label, touched, preview], index) => {
      cy.findAllByRole('listitem')
        .eq(index)
        .within(() => {
          cy.findByText(label).should('be.visible')
          cy.findByText(formatDate(touched)).should('be.visible')
          cy.findByText(preview).should('be.visible')
        })
    })
  })

  it('discards a listed draft while another is open, leaving the open one as it was', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findAllByRole('listitem').eq(0).findByRole('button', { name: 'Resume' }).click()
    cy.findByText('Never mind').should('be.visible')

    cy.findAllByRole('listitem').eq(1).findByRole('button', { name: 'Discard' }).click()

    // The list is reread from disk after a discard, so the row going is the delete landing.
    cy.findByText('Never mind').should('not.exist')
    cy.findByRole('textbox', { name: 'Draft' }).should('contain.text', 'Keep writing this')
  })

  it('keeps the version another tab saved first, and shows what this one had to copy', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), events: TYPED },
        }),
      ),
    )
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('textbox', { name: 'Draft' }).should('be.visible')

    // Another tab, with its own stores over the same database, writes the draft first.
    cy.then(async () => {
      setActivePinia(createPinia())
      const otherTab = useDraftsStore()
      await otherTab.resumeDraft('session-1')
      otherTab.recordChange('session-1', {
        content: textContent('Half a thought, finished elsewhere'),
        steps: [{ stepType: 'replace' }],
      })
      await otherTab.flush('session-1')
    })

    // This tab hasn't caught up, so its next write lands on a draft that has moved on.
    cy.findByRole('textbox', { name: 'Draft' }).type('{ctrl+end} here')

    cy.findByText(
      'This draft was changed elsewhere at the same time, and now shows what was saved there. ' +
        'What you had here is below.',
    ).should('be.visible')
    cy.findByText('Half a thought here').should('be.visible')
    cy.findByRole('textbox', { name: 'Draft' }).should(
      'contain.text',
      'Half a thought, finished elsewhere',
    )
  })

  it('shows all of a draft that will not reopen for copying, and still discards it', () => {
    const text =
      'Everything I meant to say about the lake that summer: the cabin, the dock, the long drive ' +
      'home, and why none of it went the way we planned.'
    cy.then(() =>
      seedDraft(draftRepository, {
        ...makeDraft('session-1', {
          entry: { content: textContent(text), title: 'Lake Tahoe', events: TYPED },
        }),
        started_at: 'not a timestamp',
      }),
    )
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('alert').should(
      'have.text',
      'This draft can’t be reopened because its start time is unreadable. Discard it and start again.',
    )
    cy.findByText('Lake Tahoe').should('be.visible')
    cy.findByText(text).should('be.visible')

    cy.findByRole('button', { name: 'Discard' }).click()
    cy.findByText('No drafts in progress.').should('be.visible')
  })

  it('says so plainly when there is nothing in progress', () => {
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByText('No drafts in progress.').should('be.visible')
  })

  it('says why when the drafts can’t be read', () => {
    cy.stub(draftRepository, 'list').rejects(new Error('Storage is unavailable'))
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('alert').should('have.text', 'Storage is unavailable')
  })

  it('reopens a draft with its words, title and dates', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', {
          entry: {
            content: textContent('Half a thought'),
            title: 'Lake Tahoe',
            dates: { ...emptyEntryDates(), occurred_at: '1994-06-11' },
            events: TYPED,
          },
        }),
      ),
    )
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()

    cy.findByRole('textbox', { name: 'Title' }).should('have.value', 'Lake Tahoe')
    cy.findByRole('textbox', { name: 'Draft' }).should('contain.text', 'Half a thought')
    cy.findByLabelText('Happened').should('have.value', '1994-06-11')
  })

  it('lands on the entry a revision revised, not a page of its own', () => {
    cy.then(async () => {
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
      return parent
    }).then((parent) => {
      const router = createTestRouter()
      cy.mount(DraftsView, { routePath: '/drafts', router })

      cy.findByRole('button', { name: 'Resume' }).click()
      cy.findByRole('button', { name: 'Save as entry' }).click()

      cy.wrap(router)
        .its('currentRoute.value')
        .should('deep.include', { name: 'entry-detail', params: { id: parent.id } })
    })
  })

  it('refuses a draft on a version since replaced, and says why', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('button', { name: 'Save as entry' }).click()

    cy.findByRole('status').should(
      'have.text',
      'This entry was revised after this draft began, so saving this would overwrite that ' +
        'version. Copy what you need, then discard it.',
    )
  })
})
