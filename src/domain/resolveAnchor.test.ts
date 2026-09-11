import { describe, expect, it } from 'vitest'
import { createDocLocation, isReplacementPair, resolveAnchorOp } from '@/domain/resolveAnchor'
import type { AnchorOp, DocLocation } from '@/types/entry'

const ORIGINAL = 'I went to Lake Tahoe with Dad'

function location(overrides: Partial<DocLocation> = {}): DocLocation {
  return {
    from: 10,
    to: 20,
    base_version_id: null,
    quote: 'Lake Tahoe',
    ...overrides,
  }
}

function comment(overrides: Partial<DocLocation> = {}): AnchorOp {
  return { kind: 'comment', at: location(overrides) }
}

describe('resolveAnchorOp', () => {
  it('is exact when the recorded positions still bracket the quote', () => {
    const resolved = resolveAnchorOp(comment(), { text: ORIGINAL })

    expect(resolved.status).toBe('exact')
    expect(resolved.range).toEqual([10, 20])
  })

  it('is mapped when a position mapper relocates it', () => {
    const shifted = `Last year ${ORIGINAL}`

    const resolved = resolveAnchorOp(comment(), {
      text: shifted,
      mapPosition: (position) => position + 10,
    })

    expect(resolved.status).toBe('mapped')
    expect(resolved.range).toEqual([20, 30])
  })

  it('falls back to finding the quote when positions have drifted', () => {
    const shifted = `Last year ${ORIGINAL}`

    const resolved = resolveAnchorOp(comment(), { text: shifted })

    expect(resolved.status).toBe('fuzzy')
    expect(shifted.slice(...(resolved.range as [number, number]))).toBe('Lake Tahoe')
  })

  it('orphans the anchor when the quoted text is gone, keeping the original wording', () => {
    const resolved = resolveAnchorOp(comment(), { text: 'I stayed home that summer' })

    expect(resolved.status).toBe('orphaned')
    expect(resolved.range).toBeUndefined()
    expect(resolved.op.kind === 'comment' && resolved.op.at.quote).toBe('Lake Tahoe')
  })

  it('uses prefix and suffix to pick between repeated quotes', () => {
    const text = 'the meeting was long. the meeting was short.'
    const op = comment({ quote: 'the meeting', suffix: ' was short', from: 0, to: 11 })

    const resolved = resolveAnchorOp(op, { text })

    expect(resolved.range).toEqual([22, 33])
  })

  it('locates a collapsed insertion point by the text that surrounded it', () => {
    const op: AnchorOp = {
      kind: 'insert',
      at: location({ from: 5, to: 5, quote: '', prefix: 'Hello', suffix: ' world' }),
      text: ' there,',
    }

    const resolved = resolveAnchorOp(op, { text: 'Well Hello world' })

    expect(resolved.status).toBe('fuzzy')
    expect(resolved.range).toEqual([10, 10])
  })

  it('keeps a collapsed insertion point exact when nothing moved', () => {
    const op: AnchorOp = {
      kind: 'insert',
      at: location({ from: 5, to: 5, quote: '', prefix: 'Hello', suffix: ' world' }),
      text: ' there,',
    }

    expect(resolveAnchorOp(op, { text: 'Hello world' }).status).toBe('exact')
  })

  it('resolves a media op against the parent’s attachments', () => {
    const op: AnchorOp = { kind: 'media', media_ref: 'blob-1' }

    expect(resolveAnchorOp(op, { text: '', mediaRefs: ['blob-1'] }).status).toBe('exact')
    expect(resolveAnchorOp(op, { text: '', mediaRefs: [] }).status).toBe('orphaned')
  })
})

describe('createDocLocation', () => {
  it('captures the quote with surrounding context', () => {
    const location = createDocLocation(ORIGINAL, 10, 20, null)

    expect(location.quote).toBe('Lake Tahoe')
    expect(location.prefix).toBe('I went to ')
    expect(location.suffix).toBe(' with Dad')
  })

  it('round-trips: a location made from a selection resolves exactly against the same text', () => {
    const location = createDocLocation(ORIGINAL, 10, 20, null)

    const resolved = resolveAnchorOp({ kind: 'comment', at: location }, { text: ORIGINAL })

    expect(resolved.status).toBe('exact')
    expect(resolved.range).toEqual([10, 20])
  })

  it('survives an edit earlier in the text by falling back to the quote', () => {
    const location = createDocLocation(ORIGINAL, 10, 20, null)
    const edited = `Last summer ${ORIGINAL}`

    const resolved = resolveAnchorOp({ kind: 'comment', at: location }, { text: edited })

    expect(resolved.status).toBe('fuzzy')
    expect(edited.slice(...(resolved.range as [number, number]))).toBe('Lake Tahoe')
  })

  it('normalises a backwards selection', () => {
    const location = createDocLocation(ORIGINAL, 20, 10, null)

    expect(location.from).toBe(10)
    expect(location.to).toBe(20)
    expect(location.quote).toBe('Lake Tahoe')
  })

  it('produces a collapsed location for a caret with no selection', () => {
    const location = createDocLocation(ORIGINAL, 9, 9, null)

    expect(location.quote).toBe('')
    expect(location.from).toBe(location.to)
    expect(
      resolveAnchorOp({ kind: 'insert', at: location, text: '!' }, { text: ORIGINAL }).status,
    ).toBe('exact')
  })
})

describe('isReplacementPair', () => {
  it('pairs a strike with an insert that lands inside it', () => {
    const strike = resolveAnchorOp({ kind: 'strike', at: location() }, { text: ORIGINAL })
    const insert = resolveAnchorOp(
      {
        kind: 'insert',
        at: location({ from: 20, to: 20, quote: '', prefix: 'Lake Tahoe' }),
        text: ' Lake Tahoe, actually',
      },
      { text: ORIGINAL },
    )

    expect(isReplacementPair(strike, insert)).toBe(true)
  })

  it('does not pair ops that touch unrelated places', () => {
    const strike = resolveAnchorOp({ kind: 'strike', at: location() }, { text: ORIGINAL })
    const insert = resolveAnchorOp(
      {
        kind: 'insert',
        at: location({ from: 0, to: 0, quote: '', suffix: 'I went' }),
        text: 'Yesterday, ',
      },
      { text: ORIGINAL },
    )

    expect(isReplacementPair(strike, insert)).toBe(false)
  })
})
