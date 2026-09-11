/**
 * Selects a character range inside a rendered document editor and lets ProseMirror pick the
 * change up the same way it would a real drag-select: through the browser's own `selectionchange`
 * event, which its view already listens for.
 *
 * Walks every text node under the editor in document order rather than assuming the content is one
 * text node — true for a freshly-seeded paragraph, false the moment a mark splits it into siblings
 * (e.g. an anchor already covering part of the text being revised).
 *
 * Shared between `DocumentEditor` and `EntryDetailView` specs in both runners, since none of them
 * has any other way to drive a ProseMirror selection without a real mouse.
 */
export function selectTextRange(editorEl: Element, from: number, to: number): void {
  const doc = editorEl.ownerDocument
  const walker = doc.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text)
  }

  function locate(offset: number): { node: Text; offset: number } {
    let remaining = offset
    for (const node of textNodes) {
      if (remaining <= node.data.length) return { node, offset: remaining }
      remaining -= node.data.length
    }
    const last = textNodes[textNodes.length - 1]
    if (!last) throw new Error('Editor has no text to select')
    return { node: last, offset: last.data.length }
  }

  const start = locate(from)
  const end = locate(to)

  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)

  const selection = doc.defaultView?.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  doc.dispatchEvent(new Event('selectionchange'))
}
