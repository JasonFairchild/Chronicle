// The Cypress half of the duplicated pair, mirroring `useMedia.browser.test.ts`. Nothing is mounted:
// `useMedia`'s only tie to a component is `onScopeDispose`, which an `effectScope` satisfies
// directly, so a host component would add a wrapper to test through rather than reach anything a
// scope can't. What it does need is the real browser both runners give it — object URLs and OPFS
// have nothing to fall back to in node.

import { effectScope } from 'vue'

import { useMedia } from '@/composables/useMedia'

function imageFor(mediaRef: string): HTMLImageElement {
  const image = document.createElement('img')
  image.dataset.mediaRef = mediaRef
  return image
}

describe('useMedia', () => {
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

    expect([...bytes]).to.deep.equal([1, 2, 3])
    // Resolved together, the two share a URL rather than leaking a second one.
    expect(second.src).to.equal(first.src)
  })

  it('resolves every unfilled image under a root, and says so where the blob has gone', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([7])], { type: 'image/png' }))
    const stored = imageFor(mediaRef)
    const missing = imageFor('never-stored')
    root.append(stored, missing)

    await media.applyTo(root)

    expect(stored.src.startsWith('blob:')).to.equal(true)
    expect(missing.hasAttribute('src')).to.equal(false)
    expect(missing.alt).to.equal('Attachment is no longer available')
  })

  it('leaves an src that is already there alone, so a resolved image is never refetched', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([7])], { type: 'image/png' }))
    const image = imageFor(mediaRef)
    image.src = 'data:image/png;base64,'
    root.append(image)

    await media.applyTo(root)

    expect(image.src).to.equal('data:image/png;base64,')
  })

  it('revokes every URL it minted once the scope using it goes away', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([9])], { type: 'image/png' }))
    const image = imageFor(mediaRef)
    root.append(image)
    await media.applyTo(root)

    scope.stop()

    // Chai has no rejection assertion wired up here, so the rejection is caught by hand.
    let revoked = false
    await fetch(image.src).catch(() => {
      revoked = true
    })
    expect(revoked).to.equal(true)
  })
})
