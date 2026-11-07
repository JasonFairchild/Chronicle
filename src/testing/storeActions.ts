import type { PiniaPluginContext } from 'pinia'

/**
 * Store actions still running, across every Pinia a spec mounts with. Unmounting a view starts
 * work it never awaits (it abandons its draft session, writing to disk), so teardown waits on
 * this before deleting the test database out from under it.
 */
const pending = new Set<Promise<void>>()

/** A Pinia plugin recording each action from its call until it resolves or throws. */
export function trackStoreActions({ store }: PiniaPluginContext): void {
  store.$onAction(({ after, onError }) => {
    const done = new Promise<void>((resolve) => {
      after(() => resolve())
      onError(() => resolve())
    })
    pending.add(done)
    void done.then(() => pending.delete(done))
  })
}

/** Resolves once no tracked action is running, including any a finishing one started. */
export async function settleStoreActions(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending)
}
