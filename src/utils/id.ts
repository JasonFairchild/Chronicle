// Ids and timestamps for anything stored: entries, draft sessions, mark sets, media files.

/** Which millisecond an id lands in, and its place within that millisecond. */
export interface IdClock {
  ms: number
  counter: number
}

/**
 * Advances the clock by one id. The millisecond is a floor, not a straight clock read:
 * `compareEntries` ties on id, so a backwards clock adjustment or a counter overflow must never
 * emit an id that sorts before one already issued.
 */
export function advanceIdClock(previous: IdClock, now: number): IdClock {
  const maxCounter = 0x0fff // 12 bits — the widest value the UUIDv7 rand_a field can hold.

  if (now > previous.ms) return { ms: now, counter: 0 }
  if (previous.counter >= maxCounter) return { ms: previous.ms + 1, counter: 0 }

  return { ms: previous.ms, counter: previous.counter + 1 }
}

/** -1 sorts before any real timestamp. */
let idClock: IdClock = { ms: -1, counter: 0 }

/** UUIDv7 — sortable as plain text since the millisecond timestamp leads. */
export function newId(): string {
  idClock = advanceIdClock(idClock, Date.now())

  const { ms: timestamp, counter } = idClock
  const bytes = crypto.getRandomValues(new Uint8Array(16))

  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff
  bytes[5] = timestamp & 0xff

  // Version 7 in the high nibble, then the counter across the remaining 12 bits.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f)
  bytes[7] = counter & 0xff
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 9562 variant bits.

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export function newTimestamp(): string {
  return new Date().toISOString()
}
