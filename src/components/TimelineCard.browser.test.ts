import { describe, expect, it } from 'vitest'
import TimelineCard from '@/components/TimelineCard.vue'
import { textContent } from '@/domain/entryDocument'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { emptyEntryDates, type AggregatedEntry } from '@/types/entry'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function makeAggregated(overrides: Partial<AggregatedEntry> = {}): AggregatedEntry {
  return {
    id: 'entry-1',
    created_at: CREATED_AT,
    dates: emptyEntryDates(),
    title: null,
    content: textContent('A quiet morning'),
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

  it('leaves the name slot empty when the entry has no title', async () => {
    const screen = await mountCard(makeAggregated())

    // No stand-in label: the summary below already opens with the entry's own words, so a fallback
    // in this slot would print the same text twice.
    expect(screen.getByText('Entry').elements()).toHaveLength(0)
    await expect.element(screen.getByText('A quiet morning')).toBeVisible()
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
        content: textContent('A quiet morning, reworded'),
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
