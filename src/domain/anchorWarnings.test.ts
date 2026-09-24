import { describe, expect, it } from 'vitest'
import { changesInside } from '@/domain/anchorWarnings'

// An anchor covering positions 10–20, as in "I went to |Lake Tahoe| with Dad".
const span = { from: 10, to: 20 }

describe('changesInside', () => {
  it('ignores an edit elsewhere, which only shifts the anchor', () => {
    expect(changesInside(span, { from: 3, to: 3 })).toBe(false)
    expect(changesInside(span, { from: 22, to: 25 })).toBe(false)
  })

  it('ignores text typed right against either edge, since it lands outside the span', () => {
    expect(changesInside(span, { from: 10, to: 10 })).toBe(false)
    expect(changesInside(span, { from: 20, to: 20 })).toBe(false)
  })

  it('ignores a deletion that ends or starts exactly at an edge', () => {
    expect(changesInside(span, { from: 5, to: 10 })).toBe(false)
    expect(changesInside(span, { from: 20, to: 24 })).toBe(false)
  })

  it('flags text inserted inside the span', () => {
    expect(changesInside(span, { from: 11, to: 11 })).toBe(true)
  })

  it('flags a removal overlapping any part of the span', () => {
    expect(changesInside(span, { from: 12, to: 14 })).toBe(true) // within — a same-length paste looks like this
    expect(changesInside(span, { from: 8, to: 11 })).toBe(true) // across the start
    expect(changesInside(span, { from: 19, to: 23 })).toBe(true) // across the end
    expect(changesInside(span, { from: 5, to: 25 })).toBe(true) // the whole of it
  })
})
