'use client';

import React from 'react';
import { Badge, IconButton, Tooltip } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import type { CommentCardKey } from '@perfana/shared/constants/comment-cards';
import type { CommentItemCounts } from '@/lib/test-run-comments';
import { useComments } from './CommentsContext';

/**
 * A row's comment control. With threads on the row it shows a filled icon (with an unread dot
 * when others wrote since you last looked) and opens the card's drawer on those threads; without,
 * it is an outlined icon, visible on row hover or focus (the row should set
 * `'&:hover .row-comment-button, &:focus-within .row-comment-button': { opacity: 1 }`), that starts
 * a comment anchored to the row.
 */
export default function RowCommentButton({
  card,
  itemKey,
  itemLabel,
  counts,
}: {
  card: CommentCardKey;
  itemKey: string;
  itemLabel: string;
  counts: CommentItemCounts;
}) {
  const ctx = useComments();
  if (!ctx) return null;
  const c = counts[itemKey];
  const has = (c?.threads ?? 0) > 0;
  const unread = c?.unread ?? 0;
  const label = has
    ? `${c!.threads} comment thread${c!.threads === 1 ? '' : 's'} on ${itemLabel}${unread ? `, ${unread} unread` : ''}`
    : `Comment on ${itemLabel}`;
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        className="row-comment-button"
        aria-label={label}
        data-testid={`row-comment-${itemKey}`}
        onClick={(e) => {
          e.stopPropagation(); // rows expand on click
          ctx.commentOnItem(card, itemKey, itemLabel);
        }}
        sx={{ opacity: has ? 1 : 0, transition: 'opacity 120ms', '&:focus-visible': { opacity: 1 } }}
      >
        <Badge color="primary" variant="dot" invisible={unread === 0}>
          {has ? <ChatBubbleIcon sx={{ fontSize: 16 }} color="primary" /> : <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />}
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
