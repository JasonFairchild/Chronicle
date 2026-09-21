import { effectScope } from 'vue'
import { useMedia } from '@/composables/useMedia'
import { freshMediaRepository } from '@/testing/realRepositories'

/**
 * The Cypress half of the duplicated pair, mirroring `useMedia.browser.test.ts`. Nothing is mounted:
 * `useMedia`'s only tie to a component is `onScopeDispose`, which an `effectScope` satisfies
 * directly, so a host component would add a wrapper to test through rather than reach anything a
 * scope can't. What it does need is the real browser both runners give it — object URLs and OPFS
 * have nothing to fall back to in node.
 */
describe('useMedia', () => {
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

    expect([...bytes]).to.deep.equal([1, 2, 3])
    // Asking twice reuses the URL rather than leaking a second one for the same blob.
    expect(await media.urlFor(mediaRef)).to.equal(url)
  })

  it('reports an id whose blob is gone rather than inventing a URL for it', async () => {
    expect(await media.urlFor('never-stored')).to.equal(null)
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

    expect(stored.src.startsWith('blob:')).to.equal(true)
    expect(missing.hasAttribute('src')).to.equal(false)
    expect(missing.alt).to.equal('Attachment is no longer available')
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

    expect(image.src).to.equal(first)
  })

  it('revokes every URL it minted once the scope using it goes away', async () => {
    const mediaRef = await media.store(new Blob([Uint8Array.from([9])], { type: 'image/png' }))
    const url = (await media.urlFor(mediaRef))!

    scope.stop()

    // Chai has no rejection assertion wired up here, so the rejection is caught by hand.
    let revoked = false
    await fetch(url).catch(() => {
      revoked = true
    })
    expect(revoked).to.equal(true)
  })
})
