import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import EntryForm from '@/components/EntryForm.vue'
import { docToPlainText } from '@/domain/entryDocument'
import { draftRepository } from '@/repositories'
import type { DexieEntryRepository } from '@/repositories/dexieEntryRepository'
import { renderComponent } from '@/testing/renderComponent'
import { freshDraftRepository, freshEntryRepository } from '@/testing/realRepositories'

describe('EntryForm (browser)', () => {
  let entries: DexieEntryRepository

  beforeEach(() => {
    entries = freshEntryRepository()
    freshDraftRepository()
  })

  function mountForm(props: { disabled?: boolean } = {}) {
    return renderComponent(EntryForm, { props })
  }

  it('holds a session as a draft and commits one entry only when it is saved', async () => {
    const screen = mountForm()

    await screen.getByRole('textbox', { name: 'Title' }).fill('Lake Tahoe')
    await userEvent.keyboard('{Enter}We drove up on Friday.')

    // Still a draft: nothing a person has not finished belongs in the timeline.
    expect(await entries.listRootEntries()).toEqual([])

    await screen.getByRole('button', { name: 'Save entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listRootEntries()).toHaveLength(1)
    })

    const [saved] = await entries.listRootEntries()
    expect(saved?.title).toBe('Lake Tahoe')
    expect(docToPlainText(saved!.content)).toBe('We drove up on Friday.')
    expect(saved?.authoring_trace?.steps.length).toBeGreaterThan(0)
    // The buffer is working space, so sealing discards it rather than leaving a duplicate behind.
    expect(await draftRepository.list()).toEqual([])
  })

  it('saves when something happened and when it was first written down, with the entry', async () => {
    const screen = mountForm()

    // Exact, or "Happened" would also match the "Time it happened" beside it.
    await screen.getByLabelText('Happened', { exact: true }).fill('1994-06-11')
    await screen.getByLabelText('Time it happened').fill('late morning')
    await screen.getByLabelText('Originally written', { exact: true }).fill('1994-06-12')
    await screen.getByRole('textbox', { name: 'Title' }).fill('The green notebook')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('From the green notebook')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listRootEntries()).toHaveLength(1)
    })

    const [saved] = await entries.listRootEntries()
    expect(saved?.dates.occurred_at).toBe('1994-06-11')
    expect(saved?.dates.occurred_time_note).toBe('late morning')
    expect(saved?.dates.recorded_at).toBe('1994-06-12')
    // Not asked for, so not invented.
    expect(saved?.dates.recorded_time_note).toBeNull()
  })

  it('starts a fresh empty session after a save rather than reopening the last one', async () => {
    const screen = mountForm()

    await screen.getByRole('textbox', { name: 'Title' }).fill('The first one')
    await screen.getByRole('textbox', { name: 'New entry' }).fill('First entry')
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await vi.waitFor(async () => {
      expect(await entries.listRootEntries()).toHaveLength(1)
    })

    await expect.element(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled()
    await vi.waitFor(() => {
      expect(screen.getByText('First entry').query()).toBeNull()
    })
  })

  it('leaves no draft behind for a composer that was only opened', async () => {
    const screen = mountForm({ disabled: true })

    // What the timeline finishing its load looks like from here. An editor becoming editable is
    // not an edit: treating it as one would start a writing session nobody began, leaving an empty
    // draft behind per visit to the page.
    await screen.rerender({ disabled: false })
    screen.unmount()

    await vi.waitFor(async () => {
      expect(await draftRepository.list()).toEqual([])
    })
  })

  it('will not save an empty document', async () => {
    const screen = mountForm()

    await expect.element(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled()

    await screen.getByRole('textbox', { name: 'New entry' }).fill('   ')

    await expect.element(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled()
  })

  it('saves an entry that was never given a title', async () => {
    const screen = mountForm()

    // The title field is offered and skipped. A daily journal is mostly entries nobody would name,
    // and a required title there produces filler rather than better names.
    await screen.getByRole('textbox', { name: 'New entry' }).fill('We drove up on Friday.')

    await expect.element(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled()
    await screen.getByRole('button', { name: 'Save entry' }).click()

    await vi.waitFor(async () => {
      const [saved] = await entries.listRootEntries()
      expect(saved?.title).toBeNull()
      expect(docToPlainText(saved!.content)).toBe('We drove up on Friday.')
    })
  })
})
