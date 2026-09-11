/**
 * Blob storage for the bytes an entry's document points at.
 *
 * Images live here rather than in the entry row for two reasons. Entries are immutable and get
 * copied forward by every revision, so inlining a photo would duplicate megabytes per edit. And a
 * document referring to a blob by id is what lets `media_refs` be derived from the document instead
 * of maintained alongside it, so a removed attachment leaves a dangling id rather than a broken
 * data URL.
 */
export interface MediaRepository {
  /** Stores the bytes and returns the id the document will refer to. */
  put(blob: Blob): Promise<string>
  get(id: string): Promise<Blob | null>
  delete(id: string): Promise<void>
  list(): Promise<string[]>
}

/** Extensions are the only place OPFS can keep a file's type, so the map is shared by both adapters. */
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

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? 'bin'
}

export function mimeForMediaId(id: string): string {
  const extension = id.slice(id.lastIndexOf('.') + 1)
  return EXTENSION_MIMES[extension] ?? 'application/octet-stream'
}
