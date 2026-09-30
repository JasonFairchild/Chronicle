import DraftsView from '@/views/DraftsView.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import type { DraftRepository } from '@/repositories/draftRepository'
import type { EntryRepository } from '@/repositories/entryRepository'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView', () => {
  let drafts: DraftRepository
  let entries: EntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  it('resumes an unsealed session and finishes it as one entry', () => {
    cy.then(() =>
      seedDraft(
        drafts,
        makeDraft('session-1', {
          entry: { content: textContent('Half a thought'), title: 'Lake Tahoe', events: TYPED },
        }),
      ),
    )
    cy.mount(DraftsView)

    cy.findByText('Half a thought').should('be.visible')
    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('textbox', { name: 'Draft' }).type('{ctrl+end}, finished at last.')
    cy.findByRole('button', { name: 'Save as entry' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')

    cy.then(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.title).to.equal('Lake Tahoe')
      expect(docToPlainText(saved!.content)).to.equal('Half a thought, finished at last.')
      // Sealing discards the buffer, so the same words cannot exist twice.
      expect(await drafts.list()).to.have.length(0)
    })
  })

  it('names what each draft is attached to rather than only what kind it is', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView)

    cy.findByText('Related entry on “The meeting went badly”').should('be.visible')
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
    cy.mount(DraftsView)

    cy.findByRole('button', { name: 'Resume' }).click()

    // An anchor-mode session edits two documents at once, and leaving it is not the same as
    // finishing it: the parent it was marking has to come back with it.
    cy.findByRole('heading', { name: 'This entry' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Entry being annotated' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Related entry' }).should('be.visible')

    cy.findByRole('button', { name: 'Add entry' }).click()

    // The anchor placed before the reload is still the one the sealed related entry refers to.
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
    cy.mount(DraftsView)

    cy.findByText('Never mind').should('be.visible')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')
    cy.then(async () => {
      expect(await entries.listRootEntries()).to.have.length(0)
    })
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
    cy.mount(DraftsView)

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
    cy.mount(DraftsView)

    cy.findByText('No drafts in progress.').should('be.visible')
  })
})
