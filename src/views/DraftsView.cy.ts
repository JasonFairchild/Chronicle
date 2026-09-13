import DraftsView from '@/views/DraftsView.vue'
import { docToPlainText, textContent } from '@/domain/entryDocument'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'
import { withAnchorMark } from '@/testing/anchorFixtures'
import type { Draft } from '@/types/draft'
import { createEntryInput, emptyEntryDates } from '@/types/entry'

function makeDraft(overrides: Partial<Draft> & Pick<Draft, 'session_id'>): Draft {
  return {
    target: { kind: 'new_root' },
    started_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:02.000Z',
    content: '',
    dates: emptyEntryDates(),
    anchor_ids: [],
    parent_content: null,
    steps: [{ at: '2026-09-05T10:00:01.000Z', step: { stepType: 'replace' } }],
    parent_steps: [],
    ticks: [],
    ...overrides,
  }
}

describe('DraftsView', () => {
  let drafts: DexieDraftRepository
  let entries: DexieEntryRepository

  beforeEach(() => {
    drafts = freshDraftRepository()
    entries = freshEntryRepository()
  })

  function mountDrafts() {
    cy.mount(DraftsView)
  }

  it('resumes an unsealed session and finishes it as one entry', () => {
    cy.then(() =>
      drafts.save(
        makeDraft({
          session_id: 'session-1',
          content: textContent('Half a thought', 'Lake Tahoe'),
        }),
      ),
    )
    mountDrafts()

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
      await drafts.save(
        makeDraft({
          session_id: 'session-1',
          target: { kind: 'new_child', parent_id: parent.id },
          content: textContent('It was salvaged later'),
        }),
      )
    })
    mountDrafts()

    cy.findByText('Related entry on “The meeting went badly”').should('be.visible')
  })

  it('reopens a related-entry draft on both halves, not the note alone', () => {
    let parentId = ''

    cy.then(async () => {
      const parent = await entries.create(
        createEntryInput({ content: textContent('I went to Lake Tahoe with Dad') }),
      )
      parentId = parent.id
      await drafts.save(
        makeDraft({
          session_id: 'session-1',
          target: { kind: 'new_child', parent_id: parent.id },
          content: textContent('Wrong lake'),
          parent_content: withAnchorMark(
            'I went to Lake Tahoe with Dad',
            'anchor-1',
            10,
            20,
            'strike',
          ),
          anchor_ids: ['anchor-1'],
        }),
      )
    })
    mountDrafts()

    cy.findByRole('button', { name: 'Resume' }).click()

    // An anchor-mode session edits two documents at once, and leaving it is not the same as
    // finishing it: the parent it was marking has to come back with it.
    cy.findByRole('heading', { name: 'This entry' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Entry being annotated' }).should('be.visible')
    cy.findByRole('textbox', { name: 'Your note' }).should('be.visible')

    cy.findByRole('button', { name: 'Add entry' }).click()

    // The anchor placed before the reload is still the one the sealed child refers to.
    cy.then(() => entries.listChildren(parentId)).then((children) => {
      expect(children).to.have.length(1)
      expect(children[0]?.anchors[0]?.quote).to.equal('Lake Tahoe')
      expect(children[0]?.relation_type).to.equal('update')
    })
  })

  it('discards a draft on request, the one thing that removes work', () => {
    cy.then(() =>
      drafts.save(makeDraft({ session_id: 'session-1', content: textContent('Never mind') })),
    )
    mountDrafts()

    cy.findByText('Never mind').should('be.visible')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')
    cy.then(async () => {
      expect(await entries.listRootEntries()).to.have.length(0)
    })
  })

  it('says so plainly when there is nothing in progress', () => {
    mountDrafts()

    cy.findByText('No drafts in progress.').should('be.visible')
  })
})
