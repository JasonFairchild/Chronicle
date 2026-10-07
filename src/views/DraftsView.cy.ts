import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import DraftsView from '@/views/DraftsView.vue'
import { textContent } from '@/domain/entryDocument'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import { useDraftsStore } from '@/stores/draftsStore'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, emptyEntryDates } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView', () => {
  let drafts: DraftRepository
  let entries: EntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  it('resumes a draft with its words, title and dates, and lands on the entry it becomes', () => {
    cy.then(() =>
      seedDraft(
        drafts,
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
    cy.mount(App, { routePath: '/drafts' })

    cy.findByText('Half a thought').should('be.visible')
    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByLabelText('Happened').should('have.value', '1994-06-11')
    cy.findByRole('textbox', { name: 'Draft' }).type('{ctrl+end}, finished at last.')
    cy.findByRole('button', { name: 'Save as entry' }).click()

    cy.findByRole('heading', { name: 'Lake Tahoe' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Entry content' }).should(
      'contain.text',
      'Half a thought, finished at last.',
    )
    cy.findByText(/Happened .*1994/).should('be.visible')
    cy.then(async () => {
      // Sealing discards the buffer, so the same words cannot exist twice.
      expect(await drafts.list()).to.have.length(0)
    })
  })

  it('saves a revision from its draft and lands on the entry it revised', () => {
    cy.then(async () => {
      const parent = await entries.create(
        createEntryInput({ content: textContent('The first go') }),
      )
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
    })
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('button', { name: 'Save as entry' }).click()

    // A revision is a version of the entry, not a page of its own.
    cy.findByText('Version 2 of 2').should('be.visible')
    cy.findByRole('textbox', { name: 'Entry content' }).should(
      'contain.text',
      'The first go, reworded',
    )
  })

  it('lists drafts newest first, each with what it would become, when, and how it begins', () => {
    cy.then(async () => {
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

  it('reopens a related-entry draft on both halves, not the related entry alone', () => {
    let parentId = ''

    cy.then(async () => {
      const parent = await entries.create(
        createEntryInput({ content: textContent('I went to Lake Tahoe with Dad') }),
      )
      parentId = parent.id
      await seedDraft(
        drafts,
        makeDraft('session-1', {
          entry: { content: textContent('Wrong lake'), events: TYPED },
          // The parent as this session found it, against which "anchor-1 is ours" still reads
          // after the reload — see `anchorsPlacedSince` (`domain/anchors.ts`).
          kind: relatedTo(parent, {
            content: withAnchorMark('I went to Lake Tahoe with Dad', 'anchor-1', 10, 20, 'strike'),
          }),
        }),
      )
    })
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()

    // An anchor-mode session edits two documents at once, and leaving it is not the same as
    // finishing it: the parent it was marking has to come back with it.
    cy.findByRole('heading', { name: 'This entry' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Entry being annotated' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Related entry' }).should('be.visible')

    cy.findByRole('button', { name: 'Add entry' }).click()

    // Lands on the related entry once the save has landed. The anchor placed before the reload is
    // still the one it refers to.
    cy.findByRole('link', { name: 'I went to Lake Tahoe with Dad' }).should('be.visible')
    cy.then(() => entries.listChildren(parentId)).then((children) => {
      expect(children).to.have.length(1)
      expect(children[0]?.anchors[0]?.quote).to.equal('Lake Tahoe')
      expect(children[0]?.relation_type).to.equal('update')
    })
  })

  it('discards a draft on request, the one thing that removes work', () => {
    cy.then(() =>
      seedDraft(
        drafts,
        makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
      ),
    )
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByText('Never mind').should('be.visible')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')
    cy.then(async () => {
      expect(await entries.listRootEntries()).to.have.length(0)
    })
  })

  it('discards a listed draft while another is open, leaving the open one as it was', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findAllByRole('listitem').eq(0).findByRole('button', { name: 'Resume' }).click()
    cy.findByText('Never mind').should('be.visible')

    cy.findAllByRole('listitem').eq(1).findByRole('button', { name: 'Discard' }).click()

    // The list is reread from disk after a discard, so the row going is the delete landing.
    cy.findByText('Never mind').should('not.exist')
    cy.findByRole('textbox', { name: 'Draft' }).should('contain.text', 'Keep writing this')
  })

  it('refuses a draft on a version since replaced, says why, and keeps it', () => {
    let parentId = ''

    cy.then(async () => {
      const parent = await entries.create(
        createEntryInput({ content: textContent('The first go') }),
      )
      parentId = parent.id
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('button', { name: 'Save as entry' }).click()

    cy.findByRole('status').should(
      'have.text',
      'This entry was revised after this draft began, so saving this would overwrite that ' +
        'version. Copy what you need, then discard it.',
    )
    cy.then(async () => {
      expect(await entries.listRevisions(parentId)).to.have.length(1)
      expect(await drafts.list()).to.have.length(1)
    })
  })

  it('lets go of an untouched claim when the page is left', () => {
    cy.then(async () => {
      const parent = await entries.create(
        createEntryInput({ content: textContent('The first go') }),
      )
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' }).then(({ wrapper }) => {
      cy.findByRole('button', { name: 'Resume' }).click()
      cy.findByRole('textbox', { name: 'Draft' }).should('be.visible')

      cy.then(async () => {
        const abandonDraft = cy.spy(useDraftsStore(), 'abandonDraft')
        wrapper.unmount()
        expect(abandonDraft).to.have.callCount(1)
        await abandonDraft.firstCall.returnValue
      })
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByText('No drafts in progress.').should('be.visible')
  })

  it('keeps the version another tab saved first, and shows what this one had to copy', () => {
    cy.then(() =>
      seedDraft(
        drafts,
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
      seedDraft(drafts, {
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
})
