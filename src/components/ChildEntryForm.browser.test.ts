import { describe, expect, it } from 'vitest'
import ChildEntryForm, { type ChildEntrySubmission } from '@/components/ChildEntryForm.vue'
import { renderComponent } from '@/testing/renderComponent'

function mountForm() {
  const submissions: ChildEntrySubmission[] = []

  // Listeners go in `attrs`, matching how a parent uses `@submit`; `props` is for real props.
  const screen = renderComponent(ChildEntryForm, {
    attrs: {
      onSubmit: (submission: ChildEntrySubmission) => {
        submissions.push(submission)
      },
    },
  })

  return { screen, submissions }
}

describe('ChildEntryForm (browser)', () => {
  it('says the note is about the whole entry, pointing at anchoring for a specific passage', async () => {
    const { screen } = mountForm()

    await expect.element(screen.getByText(/About this entry as a whole/)).toBeVisible()
  })

  it('emits an annotation by default', async () => {
    const { screen, submissions } = mountForm()

    await screen.getByLabelText('Your note').fill('Worth remembering')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    expect(submissions).toEqual([{ relationType: 'annotation', content: 'Worth remembering' }])
  })

  it('emits the chosen relation kind', async () => {
    const { screen, submissions } = mountForm()

    await screen.getByRole('combobox', { name: 'Relation type' }).selectOptions('update')
    await screen.getByLabelText('Your note').fill('It changed since')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    expect(submissions).toEqual([{ relationType: 'update', content: 'It changed since' }])
  })

  it('refuses to submit an empty note', async () => {
    const { screen, submissions } = mountForm()

    await expect.element(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled()
    expect(submissions).toEqual([])
  })

  it('clears itself after a successful submission', async () => {
    const { screen } = mountForm()

    await screen.getByLabelText('Your note').fill('Something')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    await expect.element(screen.getByLabelText('Your note')).toHaveValue('')
  })
})
