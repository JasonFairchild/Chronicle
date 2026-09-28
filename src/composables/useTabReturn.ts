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
