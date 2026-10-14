import DraftsView from '@/views/DraftsView.vue'
import { draftRepository, entryRepository } from '@/repositories'
import { textContent } from '@/testing/documents'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput } from '@/types/entry'
import { formatDate } from '@/utils/format'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView', () => {
  it('lists drafts newest first, each with what it would become, when, how it begins, and where it resumes', () => {
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
      return parent
    }).then((parent) => {
      cy.mount(DraftsView, { routePath: '/drafts' })

      // Where Resume goes is read off each link; landing there is the page's own to prove.
      const rows = [
        [
          'New entry',
          '2026-09-05T10:04:00.000Z',
          'A thought of its own',
          '/entries/new?draft=root',
        ],
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
      rows.forEach(([label, touched, preview, resumesAt], index) => {
        cy.findAllByRole('listitem')
          .eq(index)
          .within(() => {
            cy.findByText(label).should('be.visible')
            cy.findByText(formatDate(touched)).should('be.visible')
            cy.findByText(preview).should('be.visible')
            cy.findByRole('link', { name: 'Resume' }).should('have.attr', 'href', resumesAt)
          })
      })
    })
  })

  it('names the entry a draft is on as it is called now, after a revision renamed it', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByText('Connection from “The Monday meeting”').should('be.visible')
  })

  it('discards the draft it is asked to, leaving the rest listed', () => {
    cy.then(async () => {
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
    })
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByText('Never mind').should('be.visible')
    cy.findAllByRole('listitem').eq(1).findByRole('button', { name: 'Discard' }).click()

    // The list is reread from disk after a discard, so the row going is the delete landing.
    cy.findByText('Never mind').should('not.exist')
    cy.findByText('Keep writing this').should('be.visible')
  })

  it('says so plainly when there is nothing in progress', () => {
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByText('No drafts in progress.').should('be.visible')
  })

  it('says why when the drafts can’t be read', () => {
    cy.stub(draftRepository, 'list').rejects(new Error('list rejected'))
    cy.mount(DraftsView, { routePath: '/drafts' })

    cy.findByRole('alert').should('have.text', 'list rejected')
  })
})
