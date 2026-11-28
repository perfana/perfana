/**
 * Comment anchors for the Performance Analysis tabs other than Overview. All of them live on the
 * `performance` card beside the Overview transaction rows (`["scenario","T01"]`); the prefix is
 * what tells "Show in context" which tab to open, and never parses as a transaction key.
 *
 * A Top 10 item is anchored to its list (dimension title) as well as its row, so a comment on
 * "#1 in Slowest P95" lands on that row and not on the same transaction in another list.
 */
export type Top10Tab = 'transactions' | 'requests' | 'urls';

const TAB_INDEX: Record<Top10Tab, number> = { transactions: 1, requests: 2, urls: 3 };
export const ERROR_ANALYSIS_TAB = 4;

export const top10ItemKey = (tab: Top10Tab, dimension: string, ...parts: string[]) =>
  `top10:${tab}:${JSON.stringify([dimension, ...parts])}`;

export const errorGroupItemKey = (transaction: string, sampler: string) =>
  `errors:${JSON.stringify([transaction, sampler])}`;

/** The API caps a label at 255 characters. */
export const commentItemLabel = (...parts: (string | undefined)[]) =>
  parts.filter(Boolean).join(' · ').slice(0, 255);

/** The tab index an anchor belongs to, or null for an Overview (transaction) anchor. */
export function commentItemTab(itemKey: string): number | null {
  if (itemKey.startsWith('errors:')) return ERROR_ANALYSIS_TAB;
  const m = /^top10:(transactions|requests|urls):/.exec(itemKey);
  return m ? TAB_INDEX[m[1] as Top10Tab] : null;
}

/** Hover-reveal for a row's comment button (see RowCommentButton). */
export const ROW_COMMENT_HOVER_SX = {
  '&:hover .row-comment-button, &:focus-within .row-comment-button': { opacity: 1 },
} as const;
