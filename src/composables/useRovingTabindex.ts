import { onMounted, onUpdated, type Ref } from 'vue'

type ToolbarControl = HTMLButtonElement | HTMLSelectElement

/**
 * One Tab stop for a toolbar, with the arrow keys, Home and End moving between its controls: the
 * roving tabindex of the APG toolbar pattern. The controls are the toolbar's elements marked
 * `data-toolbar-control`, in document order, so a disclosure panel inside it keeps ordinary Tab
 * stops of its own.
 *
 * The stop is set on the elements directly, after every render, rather than bound in the template:
 * it has to skip a disabled control, which only the rendered DOM knows in one place.
 */
export function useRovingTabindex(toolbar: Readonly<Ref<HTMLElement | null>>) {
  /** The control last focused, which keeps the stop while it stays enabled. */
  let current: ToolbarControl | null = null

  function controls(): ToolbarControl[] {
    return [...(toolbar.value?.querySelectorAll<ToolbarControl>('[data-toolbar-control]') ?? [])]
  }

  function placeStop(): void {
    const all = controls()
    const stop =
      all.find((control) => control === current && !control.disabled) ??
      all.find((control) => !control.disabled)
    for (const control of all) control.tabIndex = control === stop ? 0 : -1
  }

  onMounted(placeStop)
  onUpdated(placeStop)

  function handleFocusin(event: FocusEvent): void {
    const control = controls().find((candidate) => candidate === event.target)
    if (!control) return
    current = control
    placeStop()
  }

  function handleKeydown(event: KeyboardEvent): void {
    const enabled = controls().filter((control) => !control.disabled)
    const index = enabled.findIndex((control) => control === event.target)
    if (index === -1) return

    const last = enabled.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }

    // Also keeps a closed `<select>` from changing its value on Left and Right.
    event.preventDefault()
    enabled[next]!.focus()
  }

  return { handleFocusin, handleKeydown }
}
