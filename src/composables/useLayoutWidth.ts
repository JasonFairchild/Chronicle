import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/**
 * How wide the page's content column may be.
 *
 * Exactly one thing needs this today: an anchor-mode session puts the parent's text and the child's
 * prose side by side, and two columns of a readable width do not fit where every other page wants a
 * single one. The layout owns the value and a view raises it for as long as it needs it, which keeps
 * the decision out of the router and out of a global.
 */
export type LayoutWidth = 'normal' | 'wide'

const layoutWidthKey: InjectionKey<Ref<LayoutWidth>> = Symbol('layout-width')

export function provideLayoutWidth(): Ref<LayoutWidth> {
  const width = ref<LayoutWidth>('normal')
  provide(layoutWidthKey, width)
  return width
}

/**
 * Falls back to a ref of its own when nothing is providing one, so a view mounted bare in a test
 * can still ask for width without the test standing a layout up around it. The factory form matters:
 * a plain default would hand every caller the same ref.
 */
export function useLayoutWidth(): Ref<LayoutWidth> {
  return inject(layoutWidthKey, () => ref<LayoutWidth>('normal'), true)
}
