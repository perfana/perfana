'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import type { CommentCardKey } from '@perfana/shared/constants/comment-cards';
import type { CommentItemCounts } from '@/lib/test-run-comments';
import RowCommentButton from './RowCommentButton';

/**
 * A named section of a card that takes comments of its own (a Splunk panel, a Dynatrace
 * service, a tracing service, a Pyroscope profiler): its title, extra controls, and an
 * always-visible comment button. Carries `data-comment-item` so a focused comment scrolls here.
 */
export default function ItemCommentHeader({
  card,
  itemKey,
  itemLabel,
  counts,
  title,
  children,
}: {
  card: CommentCardKey;
  itemKey: string;
  itemLabel: string;
  counts: CommentItemCounts;
  /** Defaults to the item label; pass `null` when the surrounding UI already names the item. */
  title?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Box
      data-comment-item={itemKey}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, borderRadius: 1, '& .row-comment-button': { opacity: 1 } }}
    >
      {title !== null && (
        <Typography variant="subtitle2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
          {title ?? itemLabel}
        </Typography>
      )}
      {children}
      <Box sx={{ ml: 'auto' }}>
        <RowCommentButton card={card} itemKey={itemKey} itemLabel={itemLabel} counts={counts} />
      </Box>
    </Box>
  );
}

/**
 * Small mark for a tab label whose item has comments; red when some are unread. `itemKey` may be a
 * predicate when one tab holds several anchors (a tracing service under different filters).
 */
export function TabCommentMark({ counts, itemKey }: { counts: CommentItemCounts; itemKey: string | ((key: string) => boolean) }) {
  const c =
    typeof itemKey === 'string'
      ? counts[itemKey]
      : Object.entries(counts)
          .filter(([k]) => itemKey(k))
          .reduce((a, [, v]) => ({ threads: a.threads + v.threads, unread: a.unread + v.unread }), { threads: 0, unread: 0 });
  if (!c?.threads) return null;
  return (
    <ChatBubbleIcon
      aria-label={c.unread ? `${c.unread} unread comments` : `${c.threads} comment threads`}
      sx={{ fontSize: 12, ml: 0.75, color: c.unread ? 'error.main' : 'text.secondary', verticalAlign: 'middle' }}
    />
  );
}

/** Tab handlers ignore their event; this lets a comment focus call them. */
export const NO_EVENT = null as unknown as React.SyntheticEvent;
