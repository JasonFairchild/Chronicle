import TimelineCard from '@/components/TimelineCard.vue'
import { textContent } from '@/domain/entryDocument'
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

function mountCard(entry: AggregatedEntry): void {
  cy.mount(TimelineCard, { props: { entry }, routePath: '/' })
}

describe('TimelineCard', () => {
  it('renders the entry’s current text', () => {
    mountCard(makeAggregated())

    cy.findByText('A quiet morning').should('be.visible')
  })

  it('falls back to a neutral label when the entry has no title', () => {
    mountCard(makeAggregated())

    cy.findByText('Entry').should('be.visible')
  })

  it('shows the title when one has been set', () => {
    mountCard(makeAggregated({ title: 'Tahoe trip' }))

    cy.findByText('Tahoe trip').should('be.visible')
  })

  it('stays quiet about revisions until an entry has actually been revised', () => {
    mountCard(makeAggregated())

    cy.findByText(/Revised/).should('not.exist')
  })

  it('reports how many times a revised entry has changed', () => {
    mountCard(
      makeAggregated({
        content: textContent('A quiet morning, reworded'),
        version: { index: 3, total: 3, at: CREATED_AT, revision_id: 'revision-2' },
      }),
    )

    cy.findByText('Revised 2 times').should('be.visible')
  })

  it('links through to the entry detail route', () => {
    mountCard(makeAggregated())

    cy.findByRole('link', { name: 'A quiet morning' }).should(
      'have.attr',
      'href',
      '/entries/entry-1',
    )
  })
})
