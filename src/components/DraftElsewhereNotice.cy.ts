import { reactive } from 'vue'

import DraftElsewhereNotice from '@/components/DraftElsewhereNotice.vue'
import type { DraftSession } from '@/composables/useDraftSession'

/** A session holding only what the notice reads of it, each null unless given. */
function sessionWith(fields: Partial<DraftSession>): DraftSession {
  return reactive({ elsewhereNotice: null, unsavedText: null, ...fields }) as DraftSession
}

describe('DraftElsewhereNotice', () => {
  it('says what another tab did, until there is nothing to say', () => {
    const session = sessionWith({ elsewhereNotice: 'This draft was saved or discarded elsewhere.' })
    cy.mount(DraftElsewhereNotice, { props: { session } })

    cy.findByRole('status').should('contain.text', 'This draft was saved or discarded elsewhere.')

    cy.then(() => {
      session.elsewhereNotice = null
    })

    cy.findByRole('status').should('not.exist')
  })

  it('shows what this tab had below the notice, to copy', () => {
    cy.mount(DraftElsewhereNotice, {
      props: {
        session: sessionWith({
          elsewhereNotice: 'This draft was changed elsewhere at the same time.',
          unsavedText: 'Half a thought here',
        }),
      },
    })

    cy.findByText('This draft was changed elsewhere at the same time.').should('be.visible')
    cy.findByText('Half a thought here').should('be.visible')
  })
})
