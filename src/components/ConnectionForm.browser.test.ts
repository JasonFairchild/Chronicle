import { describe, expect, it } from 'vitest'
import ConnectionForm, { type ConnectionSubmission } from '@/components/ConnectionForm.vue'
import { renderComponent } from '@/testing/renderComponent'

const CANDIDATES = [
  { id: 'entry-1', label: 'Started the degree' },
  { id: 'entry-2', label: 'Left my job' },
]

describe('ConnectionForm (browser)', () => {
  it('submits the destination along with why the two relate', async () => {
    const submitted: ConnectionSubmission[] = []
    const screen = renderComponent(ConnectionForm, {
      props: { candidates: CANDIDATES },
      attrs: {
        onSubmit: (submission: ConnectionSubmission) => {
          submitted.push(submission)
        },
      },
    })

    await screen.getByLabelText('Connect to').selectOptions('entry-2')
    await screen.getByLabelText('How they relate').fill('led_to')
    await screen.getByLabelText('Why they relate').fill('  One made the other possible  ')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    expect(submitted).toEqual([
      { toId: 'entry-2', label: 'led_to', content: 'One made the other possible' },
    ])
  })

  it('treats the edge itself as the claim, so wording and note stay optional', async () => {
    const submitted: ConnectionSubmission[] = []
    const screen = renderComponent(ConnectionForm, {
      props: { candidates: CANDIDATES },
      attrs: {
        onSubmit: (submission: ConnectionSubmission) => {
          submitted.push(submission)
        },
      },
    })

    await screen.getByLabelText('Connect to').selectOptions('entry-1')
    await screen.getByRole('button', { name: 'Add connection' }).click()

    expect(submitted).toEqual([{ toId: 'entry-1', label: '', content: '' }])
  })

  it('refuses to submit without a destination, since direction is the point', async () => {
    const screen = renderComponent(ConnectionForm, { props: { candidates: CANDIDATES } })

    await expect.element(screen.getByRole('button', { name: 'Add connection' })).toBeDisabled()
  })

  it('says there is nothing to connect to rather than showing an empty picker', async () => {
    const screen = renderComponent(ConnectionForm, { props: { candidates: [] } })

    await expect
      .element(
        screen.getByText('There is nothing else to connect to yet. Write another entry first.'),
      )
      .toBeVisible()
    expect(screen.getByRole('button', { name: 'Add connection' }).query()).toBeNull()
  })
})
