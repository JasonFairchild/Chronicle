import App from '@/App.vue'
import { textContent } from '@/domain/entryDocument'
import { draftRepository, entryRepository } from '@/repositories'
import { useDraftsStore } from '@/stores/draftsStore'
import { withAnchorMark } from '@/testing/anchorFixtures'
import { makeDraft, relatedTo, seedDraft } from '@/testing/draftFixtures'
import { createEntryInput, emptyEntryDates } from '@/types/entry'

const TYPED = [{ kind: 'edit' as const, at: 1_000, steps: [{ stepType: 'replace' }] }]

describe('DraftsView flows', () => {
  it('resumes a draft with its words, title and dates, and lands on the entry it becomes', () => {
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
    cy.mount(App, { routePath: '/drafts' })

    cy.findByText('Half a thought').should('be.visible')
    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByLabelText('Happened').should('have.value', '1994-06-11')
    cy.findByRole('textbox', { name: 'Draft' }).type('{ctrl+end}, finished at last.')
    cy.findByRole('button', { name: 'Save as entry' }).click()

    cy.findByRole('heading', { name: 'Lake Tahoe' }).should('be.visible')
    cy.findByRole('article').should('contain.text', 'Half a thought, finished at last.')
    cy.findByText(/Happened .*1994/).should('be.visible')
    cy.then(async () => {
      // Sealing discards the buffer, so the same words cannot exist twice.
      expect(await draftRepository.list()).to.have.length(0)
    })
  })

  it('saves a revision from its draft and lands on the entry it revised', () => {
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
    })
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('button', { name: 'Save as entry' }).click()

    // A revision is a version of the entry, not a page of its own.
    cy.findByText(/Version 2 of 2/).should('be.visible')
    cy.findByRole('article').should('contain.text', 'The first go, reworded')
  })

  it('reopens a related-entry draft on both halves, not the related entry alone', () => {
    let parentId = ''

    cy.then(async () => {
      const parent = await entryRepository.create(
        createEntryInput({ content: textContent('I went to Lake Tahoe with Dad') }),
      )
      parentId = parent.id
      await seedDraft(
        draftRepository,
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
    cy.then(() => entryRepository.listChildren(parentId)).then((children) => {
      expect(children).to.have.length(1)
      expect(children[0]?.anchors[0]?.quote).to.equal('Lake Tahoe')
      expect(children[0]?.relation_type).to.equal('update')
    })
  })

  it('discards a draft on request, the one thing that removes work', () => {
    cy.then(() =>
      seedDraft(
        draftRepository,
        makeDraft('session-1', { entry: { content: textContent('Never mind'), events: TYPED } }),
      ),
    )
    cy.mount(App, { routePath: '/drafts' })

    cy.findByText('Never mind').should('be.visible')
    cy.findByRole('button', { name: 'Discard' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')
    cy.then(async () => {
      expect(await entryRepository.listRootEntries()).to.have.length(0)
    })
  })

  it('refuses a draft on a version since replaced, says why, and keeps it', () => {
    let parentId = ''

    cy.then(async () => {
      const parent = await entryRepository.create(
        createEntryInput({ content: textContent('The first go') }),
      )
      parentId = parent.id
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
    cy.mount(App, { routePath: '/drafts' })

    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('button', { name: 'Save as entry' }).click()

    cy.findByRole('status').should(
      'have.text',
      'This entry was revised after this draft began, so saving this would overwrite that ' +
        'version. Copy what you need, then discard it.',
    )
    cy.then(async () => {
      expect(await entryRepository.listRevisions(parentId)).to.have.length(1)
      expect(await draftRepository.list()).to.have.length(1)
    })
  })

  it('lets go of an untouched claim when the page is left', () => {
    cy.then(async () => {
      const parent = await entryRepository.create(
        createEntryInput({ content: textContent('The first go') }),
      )
      // A revision nobody has typed in yet: its words are still the entry's own.
      await seedDraft(
        draftRepository,
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
    cy.mount(App, { routePath: '/drafts' })
    cy.findByRole('button', { name: 'Resume' }).click()
    cy.findByRole('textbox', { name: 'Draft' }).should('be.visible')

    cy.then(() => {
      cy.spy(useDraftsStore(), 'abandonDraft').as('abandonDraft')
    })
    cy.findByRole('link', { name: 'Timeline' }).click()
    cy.get('@abandonDraft')
      .should('have.been.calledOnce')
      .then((abandonDraft) => abandonDraft.firstCall.returnValue)
    cy.findByRole('link', { name: 'Drafts' }).click()

    cy.findByText('No drafts in progress.').should('be.visible')
  })
})
