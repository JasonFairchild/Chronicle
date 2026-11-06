// Mirrored by `useMedia.cy.ts`, the ordinary duplicated pair. Nothing is mounted in either: this is
// not a component, and `useMedia`'s only tie to one is `onScopeDispose`, which an effect scope
// satisfies directly. It does need a real browser — object URLs and OPFS have nothing to fall back
// to in node.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useMedia } from '@/composables/useMedia'

function imageFor(mediaRef: string): HTMLImageElement {
  const image = document.createElement('img')
  image.dataset.mediaRef = mediaRef
  return image
}

describe('useMedia (browser)', () => {
  let scope: ReturnType<typeof effectScope>
  let media: ReturnType<typeof useMedia>
  let root: HTMLDivElement

  beforeEach(() => {
    scope = effectScope()
    media = scope.run(() => useMedia())!
    root = document.createElement('div')
  })

  afterEach(() => {
    scope.stop()
  })

  it('serves the bytes that were stored, at one object URL per id', async () => {
    const mediaRef = await media.store(
      new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
    )
    const first = imageFor(mediaRef)
    const second = imageFor(mediaRef)
    root.append(first, second)

    await media.applyTo(root)
    const bytes = new Uint8Array(await (await fetch(first.src)).arrayBuffer())

    expect(bytes).toEqual(Uint8Array.from([1, 2, 3]))
    // Resolved together, the two share a URL rather than leaking a second one.
    expect(second.src).toBe(first.src)
  })

  it('resolves every unfilled image under a root, and says so where the blob has gone', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([7])], { type: 'image/png' }))
    const stored = imageFor(mediaRef)
    const missing = imageFor('never-stored')
    root.append(stored, missing)

    await media.applyTo(root)

    expect(stored.src.startsWith('blob:')).toBe(true)
    expect(missing.hasAttribute('src')).toBe(false)
    expect(missing.alt).toBe('Attachment is no longer available')
  })

  it('leaves an src that is already there alone, so a resolved image is never refetched', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([7])], { type: 'image/png' }))
    const image = imageFor(mediaRef)
    image.src = 'data:image/png;base64,'
    root.append(image)

    await media.applyTo(root)

    expect(image.src).toBe('data:image/png;base64,')
  })

  it('revokes every URL it minted once the scope using it goes away', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([9])], { type: 'image/png' }))
    const image = imageFor(mediaRef)
    root.append(image)
    await media.applyTo(root)

    scope.stop()

    await expect(fetch(image.src)).rejects.toThrow()
  })
})
