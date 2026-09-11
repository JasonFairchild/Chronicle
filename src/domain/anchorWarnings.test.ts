import { describe, expect, it } from 'vitest'
import { anchorsAffectedBy, type AnchorMapping } from '@/domain/anchorWarnings'

function mapping(overrides: Partial<AnchorMapping> = {}): AnchorMapping {
  return {
    anchor_id: 'a1',
    quote: 'Lake Tahoe',
    length: 10,
    mappedLength: 10,
    deletedInside: false,
    ...overrides,
  }
}

describe('anchorsAffectedBy', () => {
  it('stays silent when an anchor merely shifts from an edit elsewhere', () => {
    // A shift changes position, never length or an internal deletion flag — neither is asserted
    // here, since a mapped position is not part of `AnchorMapping` at all.
    expect(anchorsAffectedBy([mapping()])).toEqual([])
  })

  it('flags an anchor whose span grew, meaning something was inserted inside it', () => {
    const grown = mapping({ mappedLength: 15 })

    expect(anchorsAffectedBy([grown])).toEqual([grown])
  })

  it('flags an anchor whose span shrank, meaning part of it was deleted', () => {
    const shrunk = mapping({ mappedLength: 4 })

    expect(anchorsAffectedBy([shrunk])).toEqual([shrunk])
  })

  it('flags an anchor deleted from the inside even when the net length matches', () => {
    // A same-size replacement of the covered text: length is unchanged, but content inside the
    // span was removed, which `deletedInside` is what catches.
    const replaced = mapping({ deletedInside: true })

    expect(anchorsAffectedBy([replaced])).toEqual([replaced])
  })

  it('keeps the order it was given, since it only filters', () => {
    const first = mapping({ anchor_id: 'a1', mappedLength: 20 })
    const untouched = mapping({ anchor_id: 'a2' })
    const second = mapping({ anchor_id: 'a3', deletedInside: true })

    expect(anchorsAffectedBy([first, untouched, second])).toEqual([first, second])
  })
})
