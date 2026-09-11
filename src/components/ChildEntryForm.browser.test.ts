import { describe, expect, it } from 'vitest'
import ChildEntryForm, { type ChildEntrySubmission } from '@/components/ChildEntryForm.vue'
import { renderComponent } from '@/testing/renderComponent'

function mountForm(quote: string | null) {
  const submissions: ChildEntrySubmission[] = []

  // Listeners go in `attrs`, matching how a parent uses `@submit`; `props` is for real props.
  const screen = renderComponent(ChildEntryForm, {
    props: { quote },
    attrs: {
      onSubmit: (submission: ChildEntrySubmission) => {
        submissions.push(submission)
      },
    },
  })

  return { screen, submissions }
}

describe('ChildEntryForm (browser)', () => {
  it('says the note is about the whole entry when nothing is selected', async () => {
    const { screen } = mountForm(null)

    await expect.element(screen.getByText(/About this entry as a whole/)).toBeVisible()
  })

  it('shows the selected passage when there is one', async () => {
    const { screen } = mountForm('Lake Tahoe')

    await expect.element(screen.getByText('“Lake Tahoe”')).toBeVisible()
  })

  it('offers no strike action without a selection, since there is nothing to strike', async () => {
    const { screen } = mountForm(null)

    expect(screen.getByRole('combobox', { name: 'Anchor action' }).query()).toBeNull()
  })

  it('emits an annotation comment by default', async () => {
    const { screen, submissions } = mountForm('Lake Tahoe')

    await screen.getByLabelText('Your note').fill('Worth remembering')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    expect(submissions).toEqual([
      {
        relationType: 'annotation',
        opKind: 'comment',
        content: 'Worth remembering',
        insertion: '',
      },
    ])
  })

  it('carries replacement wording alongside a strike', async () => {
    const { screen, submissions } = mountForm('Lake Tahoe')

    await screen.getByRole('combobox', { name: 'Relation type' }).selectOptions('update')
    await screen.getByRole('combobox', { name: 'Anchor action' }).selectOptions('strike')
    await screen.getByLabelText('Your note').fill('Wrong lake')
    await screen.getByLabelText('Replacement wording').fill('Donner Lake')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    expect(submissions).toEqual([
      {
        relationType: 'update',
        opKind: 'strike',
        content: 'Wrong lake',
        insertion: 'Donner Lake',
      },
    ])
  })

  it('asks for replacement wording only once a strike is chosen', async () => {
    const { screen } = mountForm('Lake Tahoe')

    expect(screen.getByLabelText('Replacement wording').query()).toBeNull()

    await screen.getByRole('combobox', { name: 'Anchor action' }).selectOptions('strike')

    await expect.element(screen.getByLabelText('Replacement wording')).toBeVisible()
  })

  it('refuses to submit an empty note', async () => {
    const { screen, submissions } = mountForm(null)

    await expect.element(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled()
    expect(submissions).toEqual([])
  })

  it('clears itself after a successful submission', async () => {
    const { screen } = mountForm(null)

    await screen.getByLabelText('Your note').fill('Something')
    await screen.getByRole('button', { name: 'Add entry' }).click()

    await expect.element(screen.getByLabelText('Your note')).toHaveValue('')
  })
})
