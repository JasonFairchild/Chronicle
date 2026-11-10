import { newId } from '@/utils/id'

import type { MediaRepository } from './mediaRepository'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

const EXTENSION_MIMES: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, extension]) => [extension, mime]),
)

function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? 'bin'
}

function mimeForMediaId(id: string): string {
  const extension = id.slice(id.lastIndexOf('.') + 1)
  return EXTENSION_MIMES[extension] ?? 'application/octet-stream'
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

/**
 * The Origin Private File System: real files in the browser's own storage, never surfaced to the
 * user's disk and never leaving the device. It is the right home for photos specifically because
 * it streams bytes rather than holding them in memory the way an IndexedDB value would.
 *
 * A file's name is its id. OPFS stores no MIME type of its own, so the extension carries it, which
 * is why `put` mints an id ending in one and `get` reads the type back out of it.
 */
export class OpfsMediaRepository implements MediaRepository {
  constructor(private directoryName = 'media') {}

  private async directory(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(this.directoryName, { create: true })
  }

  async put(blob: Blob): Promise<string> {
    const id = `${newId()}.${extensionForMime(blob.type)}`
    const directory = await this.directory()
    const handle = await directory.getFileHandle(id, { create: true })

    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()

    return id
  }

  async get(id: string): Promise<Blob | null> {
    const directory = await this.directory()

    try {
      const handle = await directory.getFileHandle(id)
      const file = await handle.getFile()
      // Re-typed from the id: what comes back off disk has no MIME type of its own, and an
      // untyped blob makes a useless object URL for an <img>.
      return new Blob([await file.arrayBuffer()], { type: mimeForMediaId(id) })
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }
}
