import { ANCHOR_MARK, serializeDocument } from '@/domain/entryDocument'

/**
 * A hand-built document carrying one anchor mark over `[from, to)`, standing in for what
 * `addAnchorMark` (`editor/extensions.ts`) would produce. Shared because more than one node test
 * needs a marked document and none of them has an editor to run one against.
 */
export function withAnchorMark(
  text: string,
  anchorId: string,
  from: number,
  to: number,
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
          { type: 'text', text: text.slice(to) },
        ].filter((node) => node.text !== ''),
      },
    ],
  })
}
