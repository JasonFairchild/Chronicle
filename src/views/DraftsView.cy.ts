import DraftsView from '@/views/DraftsView.vue'
import { docToPlainText, plainTextDocument, serializeDocument } from '@/domain/entryDocument'
import type { DexieDraftRepository } from '@/repositories/dexieDraftRepository'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
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
          content: serializeDocument(plainTextDocument('Half a thought', 'Lake Tahoe')),
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
      const parent = await entries.create(createEntryInput({ content: 'The meeting went badly' }))
      await drafts.save(
        makeDraft({
          session_id: 'session-1',
          target: { kind: 'new_child', parent_id: parent.id, relation_type: 'update' },
          content: 'It was salvaged later',
        }),
      )
    })
    mountDrafts()

    cy.findByText('Update on “The meeting went badly”').should('be.visible')
  })

  it('discards a draft on request, the one thing that removes work', () => {
    cy.then(() => drafts.save(makeDraft({ session_id: 'session-1', content: 'Never mind' })))
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
