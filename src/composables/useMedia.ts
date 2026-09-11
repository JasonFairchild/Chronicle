import { onScopeDispose } from 'vue'
import { mediaRepository } from '@/repositories'

/**
 * The bridge between a media id and something a browser can display.
 *
 * A document stores only the blob's id. An object URL is minted per page load and means nothing
 * anywhere else, so letting one reach the stored content would produce entries that render as
 * broken images the moment the tab is closed. This composable is the only place the two meet, and
 * it revokes every URL it created when the component using it goes away.
 */
export function useMedia() {
  const urls = new Map<string, string>()

  /** Stores a file's bytes and returns the id the document will refer to. */
  async function store(file: Blob): Promise<string> {
    return mediaRepository.put(file)
  }

  async function urlFor(mediaRef: string): Promise<string | null> {
    const existing = urls.get(mediaRef)
    if (existing) return existing

    const blob = await mediaRepository.get(mediaRef)
    if (!blob) return null

    const url = URL.createObjectURL(blob)
    urls.set(mediaRef, url)
    return url
  }

  /**
   * Fills in the `src` of every media image under `root` that lacks one.
   *
   * Reaching into the DOM rather than into the document is the point: a resolved `src` must not be
   * able to travel back into what gets saved.
   */
  async function applyTo(root: HTMLElement | null | undefined): Promise<void> {
    if (!root) return

    const images = root.querySelectorAll<HTMLImageElement>('img[data-media-ref]:not([src])')

    await Promise.all(
      [...images].map(async (image) => {
        const mediaRef = image.dataset.mediaRef
        if (!mediaRef) return

        const url = await urlFor(mediaRef)
        // An id whose blob is gone stays visibly unresolved rather than silently blank.
        if (url) image.src = url
        else image.alt = image.alt || 'Attachment is no longer available'
      }),
    )
  }

  function revokeAll(): void {
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
  }

  onScopeDispose(revokeAll)

  return { store, urlFor, applyTo, revokeAll }
}
