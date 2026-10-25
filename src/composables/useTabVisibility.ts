import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Runs `callback` whenever this tab is returned to, for as long as the calling component is
 * mounted: when the tab is shown again, or when its window regains focus. Two windows side by side
 * are both visible, so moving between them only changes focus. Coming back from another tab fires
 * both, so `callback` has to be safe to run twice.
 */
export function useTabReturn(callback: () => void): void {
  function handleVisibility(): void {
    if (document.visibilityState === 'visible') callback()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', callback)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('focus', callback)
  })
}

/**
 * Runs `callback` whenever this tab is left, for as long as the calling component is mounted: when
 * it's hidden, when its window loses focus, or when the page is unloading. A phone can kill a
 * hidden tab without `pagehide`, so hiding is the signal that matters most; moving to a window
 * beside this one only blurs it, the counterpart of `useTabReturn`'s focus. Leaving can fire all
 * three, so `callback` has to be safe to run more than once.
 */
export function useTabLeave(callback: () => void): void {
  function handleVisibility(): void {
    if (document.visibilityState === 'hidden') callback()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', callback)
    window.addEventListener('pagehide', callback)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('blur', callback)
    window.removeEventListener('pagehide', callback)
  })
}
