import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMedia } from '@/composables/useMedia'
import { freshMediaRepository } from '@/testing/realRepositories'

/**
 * A browser spec rather than a Cypress one for the same reason `DexieEntryRepository` is: this is
 * not a component, and mounting one just to reach the composable would test the wrapper instead.
 * It does need a real browser — object URLs and OPFS have nothing to fall back to in node — and it
 * needs an effect scope, since `useMedia` registers its cleanup with `onScopeDispose`.
 */
describe('useMedia (browser)', () => {
  let scope: ReturnType<typeof effectScope>
  let media: ReturnType<typeof useMedia>

  beforeEach(() => {
    freshMediaRepository()
    scope = effectScope()
    media = scope.run(() => useMedia())!
  })

  afterEach(() => {
    scope.stop()
  })

  it('mints one object URL per stored id, serving back the bytes that were put in', async () => {
    const mediaRef = await media.store(
      new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
    )

    const url = await media.urlFor(mediaRef)
    const bytes = new Uint8Array(await (await fetch(url!)).arrayBuffer())

    expect(bytes).toEqual(Uint8Array.from([1, 2, 3]))
    // Asking twice reuses the URL rather than leaking a second one for the same blob.
    expect(await media.urlFor(mediaRef)).toBe(url)
  })

  it('reports an id whose blob is gone rather than inventing a URL for it', async () => {
    expect(await media.urlFor('never-stored')).toBeNull()
  })

  it('resolves every unfilled image under a root, and says so where the blob has gone', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([7])], { type: 'image/png' }))
    const stored = document.createElement('img')
    stored.dataset.mediaRef = mediaRef
    const missing = document.createElement('img')
    missing.dataset.mediaRef = 'never-stored'
    const root = document.createElement('div')
    root.append(stored, missing)

    await media.applyTo(root)

    expect(stored.src.startsWith('blob:')).toBe(true)
    expect(missing.hasAttribute('src')).toBe(false)
    expect(missing.alt).toBe('Attachment is no longer available')
  })

  it('leaves an src that is already there alone, so a resolved image is never refetched', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([7])], { type: 'image/png' }))
    const image = document.createElement('img')
    image.dataset.mediaRef = mediaRef
    const root = document.createElement('div')
    root.append(image)

    await media.applyTo(root)
    const first = image.src
    await media.applyTo(root)

    expect(image.src).toBe(first)
  })

  it('revokes every URL it minted once the scope using it goes away', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([9])], { type: 'image/png' }))
    const url = (await media.urlFor(mediaRef))!

    scope.stop()

    await expect(fetch(url)).rejects.toThrow()
  })
})
