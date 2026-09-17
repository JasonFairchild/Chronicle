import EntryCard from '@/components/EntryCard.vue'
import { previewText, textContent } from '@/domain/entryDocument'
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

function mountCard(entry: AggregatedEntry, slots: Record<string, string> = {}): void {
  cy.mount(EntryCard, { props: { entry }, slots, routePath: '/' })
}

describe('EntryCard', () => {
  it('renders the entry’s current text exactly once, in place of a title, when untitled', () => {
    mountCard(makeAggregated())

    // No separate stand-in above it: the preview is the only line naming this entry.
    cy.findAllByText('A quiet morning').should('have.length', 1)
  })

  it('shows a long untitled entry’s text in full, not a separately truncated peek', () => {
    mountCard(makeAggregated({ content: textContent(LONG_TEXT) }))

    cy.findByText(LONG_TEXT).should('be.visible')
    // A shorter, truncated cut of the same text used to appear alongside the full one; confirming
    // it doesn't is what proves there's no second, separate excerpt any more.
    cy.findByText(previewText(textContent(LONG_TEXT), 50)).should('not.exist')
  })

  it('shows the title, with the preview still below it, when one has been set', () => {
    mountCard(makeAggregated({ title: 'Tahoe trip' }))

    cy.findByText('Tahoe trip').should('be.visible')
    cy.findByText('A quiet morning').should('be.visible')
  })

  it('always shows the created date', () => {
    mountCard(makeAggregated())

    cy.findByText(formatDate(CREATED_AT)).should('be.visible')
  })

  it('renders badge and extra slot content when given', () => {
    mountCard(makeAggregated(), {
      badge: '<span>Update</span>',
      extra: '<p>Was attached to a passage</p>',
    })

    cy.findByText('Update').should('be.visible')
    cy.findByText('Was attached to a passage').should('be.visible')
  })

  it('makes the whole card the link, not just the summary text', () => {
    mountCard(makeAggregated({ title: 'Tahoe trip' }))

    cy.findByRole('link', { name: 'Tahoe trip' }).should('have.attr', 'href', '/entries/entry-1')

    // The date sits well outside the old, text-only clickable area; if the card element itself is
    // the link, the date's own closest anchor is that same link.
    cy.findByText(formatDate(CREATED_AT))
      .parents('a')
      .first()
      .should('have.attr', 'href', '/entries/entry-1')
  })
})
