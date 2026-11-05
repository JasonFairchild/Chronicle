import { ANCHOR_MARK, ANCHOR_WORDING_MARK } from '@/domain/entryDocument'
import { serializeDocument } from '@/testing/documents'

/**
 * A hand-built document carrying one anchor: its mark over `[from, to)`, then `wording` as marked
 * text right after it, sharing its id. Stands in for what anchor mode produces, for the tests with
 * no editor to run one against. Equal `from` and `to` leave no passage: a bare insertion there.
 */
export function withAnchorWording(
  text: string,
  anchorId: string,
  from: number,
  to: number,
  wording: string,
  kind: 'comment' | 'strike' = 'comment',
): string {
  return serializeDocument({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: text.slice(0, from) },
          {
            type: 'text',
            text: text.slice(from, to),
            marks: [{ type: ANCHOR_MARK, attrs: { anchorId, kind } }],
          },
          {
            type: 'text',
            text: wording,
            marks: [{ type: ANCHOR_WORDING_MARK, attrs: { anchorId } }],
          },
          { type: 'text', text: text.slice(to) },
        ].filter((node) => node.text !== ''),
      },
    ],
  })
}

/** `withAnchorWording` with no wording: a passage alone. */
export function withAnchorMark(
  text: string,
  anchorId: string,
  from: number,
  to: number,
  kind: 'comment' | 'strike' = 'comment',
): string {
  return withAnchorWording(text, anchorId, from, to, '', kind)
}
