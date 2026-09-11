import { describe, expect, it } from 'vitest'
import TimelineCard from '@/components/TimelineCard.vue'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import type { AggregatedEntry } from '@/types/entry'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function makeAggregated(overrides: Partial<AggregatedEntry> = {}): AggregatedEntry {
  return {
    id: 'entry-1',
    created_at: CREATED_AT,
    title: null,
    content: 'A quiet morning',
    media_refs: [],
    metadata: {},
    version: { index: 1, total: 1, at: CREATED_AT, revision_id: null },
    children: [],
    connections: [],
    ...overrides,
  }
}

async function mountCard(entry: AggregatedEntry) {
  const router = createTestRouter()
  await router.push('/')
  await router.isReady()

  return renderComponent(TimelineCard, {
    props: { entry },
    global: { plugins: [router] },
  })
}

describe('TimelineCard (browser)', () => {
  it('renders the entry’s current text', async () => {
    const screen = await mountCard(makeAggregated())

    await expect.element(screen.getByText('A quiet morning')).toBeVisible()
  })

  it('falls back to a neutral label when the entry has no title', async () => {
    const screen = await mountCard(makeAggregated())

    await expect.element(screen.getByText('Entry')).toBeVisible()
  })

  it('shows the title when one has been set', async () => {
    const screen = await mountCard(makeAggregated({ title: 'Tahoe trip' }))

    await expect.element(screen.getByText('Tahoe trip')).toBeVisible()
  })

  it('stays quiet about revisions until an entry has actually been revised', async () => {
    const screen = await mountCard(makeAggregated())

    expect(screen.getByText(/Revised/).query()).toBeNull()
  })

  it('reports how many times a revised entry has changed', async () => {
    const screen = await mountCard(
      makeAggregated({
        content: 'A quiet morning, reworded',
        version: { index: 3, total: 3, at: CREATED_AT, revision_id: 'revision-2' },
      }),
    )

    await expect.element(screen.getByText('Revised 2 times')).toBeVisible()
  })

  it('links through to the entry detail route', async () => {
    const screen = await mountCard(makeAggregated())

    await expect
      .element(screen.getByRole('link', { name: 'A quiet morning' }))
      .toHaveAttribute('href', '/entries/entry-1')
  })
})
