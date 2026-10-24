import { describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { DraftSession } from '@/composables/useDraftSession'
import { useSealDraft } from '@/composables/useSealDraft'
import { InMemoryEntryRepository } from '@/repositories/inMemoryEntryRepository'
import { textContent } from '@/testing/documents'
import { createEntryInput } from '@/types/entry'

/**
 * The seal handler for a session whose save does as given, with a spy on where it navigates. The
 * session is a stand-in: its save is all the handler reads of it.
 */
function sealWith(save: DraftSession['save']) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ name: 'entry-detail', path: '/entries/:id', component: {} }],
  })
  const push = vi.spyOn(router, 'push')
  const app = createApp({}).use(router)

  const seal = app.runWithContext(() => useSealDraft({ save } as DraftSession))
  return { seal, push }
}

describe('useSealDraft', () => {
  it('lands on the page of the entry it saved', async () => {
    const saved = await new InMemoryEntryRepository().create(
      createEntryInput({ content: textContent('We drove up on Friday.') }),
    )
    const { seal, push } = sealWith(async () => saved)

    await seal()

    expect(push).toHaveBeenCalledExactlyOnceWith({
      name: 'entry-detail',
      params: { id: saved.id },
    })
  })

  it('stays put when the save writes nothing', async () => {
    const { seal, push } = sealWith(async () => null)

    await seal()

    expect(push).not.toHaveBeenCalled()
  })
})
