import { describe, expect, it } from 'vitest'
import EntryCard from '@/components/EntryCard.vue'
import { previewText, textContent } from '@/domain/entryDocument'
import { renderComponent } from '@/testing/renderComponent'
import { createTestRouter } from '@/testing/testRouter'
import { emptyEntryDates, type AggregatedEntry } from '@/types/entry'
import { formatDate } from '@/utils/format'

const CREATED_AT = '2026-01-01T00:00:00.000Z'
const LONG_TEXT =
  'A quiet morning, the fog still hanging low over the lake and everyone else still asleep'

function makeAggregated(overrides: Partial<AggregatedEntry> = {}): AggregatedEntry {
  return {
    id: 'entry-1',
    created_at: CREATED_AT,
    parent_id: null,
    relation_type: null,
    target_id: null,
    dates: emptyEntryDates(),
    location: null,
    original_medium: null,
    original_medium_note: null,
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

async function mountCard(entry: AggregatedEntry, slots: Record<string, string> = {}) {
  const router = createTestRouter()
  await router.push('/')
  await router.isReady()

  return renderComponent(EntryCard, {
    props: { entry },
    slots,
    global: { plugins: [router] },
  })
}

describe('EntryCard (browser)', () => {
  it('renders the entry’s current text exactly once, in place of a title, when untitled', async () => {
    const screen = await mountCard(makeAggregated())

    // No separate stand-in above it: the preview is the only line naming this entry.
    expect(screen.getByText('A quiet morning').elements()).toHaveLength(1)
  })

  it('shows a long untitled entry’s text in full, not a separately truncated peek', async () => {
    const screen = await mountCard(makeAggregated({ content: textContent(LONG_TEXT) }))

    await expect.element(screen.getByText(LONG_TEXT)).toBeVisible()
    // A shorter, truncated cut of the same text used to appear alongside the full one; confirming
    // it doesn't is what proves there's no second, separate excerpt any more.
    expect(screen.getByText(previewText(textContent(LONG_TEXT), 50)).query()).toBeNull()
  })

  it('shows the title, with the preview still below it, when one has been set', async () => {
    const screen = await mountCard(makeAggregated({ title: 'Tahoe trip' }))

    await expect.element(screen.getByText('Tahoe trip')).toBeVisible()
    await expect.element(screen.getByText('A quiet morning')).toBeVisible()
  })

  it('always shows the created date', async () => {
    const screen = await mountCard(makeAggregated())

    await expect.element(screen.getByText(formatDate(CREATED_AT))).toBeVisible()
  })

  it('renders badge and extra slot content when given', async () => {
    const screen = await mountCard(makeAggregated(), {
      badge: '<span>Update</span>',
      extra: '<p>Was attached to a passage</p>',
    })

    await expect.element(screen.getByText('Update')).toBeVisible()
    await expect.element(screen.getByText('Was attached to a passage')).toBeVisible()
  })

  it('makes the whole card the link, not just the summary text', async () => {
    const screen = await mountCard(makeAggregated({ title: 'Tahoe trip' }))

    const link = screen.getByRole('link', { name: 'Tahoe trip' })
    await expect.element(link).toHaveAttribute('href', '/entries/entry-1')

    // The date sits well outside the old, text-only clickable area; if the card element itself is
    // the link, the date's own closest anchor is that same link.
    const dateEl = screen.getByText(formatDate(CREATED_AT)).element()
    expect(dateEl.closest('a')).toBe(link.element())
  })
})
