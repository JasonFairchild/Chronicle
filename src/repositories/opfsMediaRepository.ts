import { newEntryId } from '@/types/entry'
import { extensionForMime, mimeForMediaId, type MediaRepository } from './mediaRepository'

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

  async put(blob: Blob): Promise<string> {
    const id = `${newEntryId()}.${extensionForMime(blob.type)}`
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

  async delete(id: string): Promise<void> {
    const directory = await this.directory()

    try {
      await directory.removeEntry(id)
    } catch (error) {
      // Deleting something already gone is the outcome the caller wanted.
      if (!isNotFound(error)) throw error
    }
  }

  async list(): Promise<string[]> {
    const directory = await this.directory()
    const ids: string[] = []

    // lib.dom does not yet declare the async iterators OPFS directory handles actually ship
    // with, so the shape is spelled out here rather than reached for untyped.
    const listable = directory as FileSystemDirectoryHandle & {
      keys(): AsyncIterableIterator<string>
    }
    for await (const name of listable.keys()) ids.push(name)

    return ids.sort()
  }

  /** Test-only: removes the whole media directory. */
  async dispose(): Promise<void> {
    const root = await navigator.storage.getDirectory()

    try {
      await root.removeEntry(this.directoryName, { recursive: true })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  private async directory(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(this.directoryName, { create: true })
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}
