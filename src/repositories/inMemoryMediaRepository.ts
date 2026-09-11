import { newEntryId } from '@/types/entry'
import { extensionForMime, mimeForMediaId, type MediaRepository } from './mediaRepository'

/**
 * The node-friendly adapter, used by store and component tests so they never need OPFS. Ids carry
 * the same extension the OPFS adapter gives them and reads re-type from that id the same way, so
 * a test written against this adapter is describing behavior the real one actually has.
 */
export class InMemoryMediaRepository implements MediaRepository {
  private blobs = new Map<string, Blob>()

  async put(blob: Blob): Promise<string> {
    const id = `${newEntryId()}.${extensionForMime(blob.type)}`
    this.blobs.set(id, blob)
    return id
  }

  async get(id: string): Promise<Blob | null> {
    const blob = this.blobs.get(id)
    return blob ? new Blob([blob], { type: mimeForMediaId(id) }) : null
  }

  async delete(id: string): Promise<void> {
    this.blobs.delete(id)
  }

  async list(): Promise<string[]> {
    return [...this.blobs.keys()].sort()
  }

  clear(): void {
    this.blobs.clear()
  }
}
