import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import DraftElsewhereNotice from '@/components/DraftElsewhereNotice.vue'
import type { DraftSession } from '@/composables/useDraftSession'
import { renderComponent } from '@/testing/renderComponent'

/** A session holding only what the notice reads of it, each null unless given. */
function sessionWith(fields: Partial<DraftSession>): DraftSession {
  return reactive({ elsewhereNotice: null, unsaved: null, ...fields }) as DraftSession
}

describe('DraftElsewhereNotice (browser)', () => {
  it('says what another tab did, until there is nothing to say', async () => {
    const session = sessionWith({ elsewhereNotice: 'This draft was saved or discarded elsewhere.' })
    const screen = renderComponent(DraftElsewhereNotice, { props: { session } })

    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('This draft was saved or discarded elsewhere.')

    session.elsewhereNotice = null

    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  })

  it('shows what this tab had below the notice, to copy', async () => {
    const screen = renderComponent(DraftElsewhereNotice, {
      props: {
        session: sessionWith({
          elsewhereNotice: 'This draft was changed elsewhere at the same time.',
          unsaved: { title: 'Lake Tahoe', text: 'Half a thought here' },
        }),
      },
    })

    await expect
      .element(screen.getByText('This draft was changed elsewhere at the same time.'))
      .toBeVisible()
    await expect.element(screen.getByText('Lake Tahoe')).toBeVisible()
    await expect.element(screen.getByText('Half a thought here')).toBeVisible()
  })
})
