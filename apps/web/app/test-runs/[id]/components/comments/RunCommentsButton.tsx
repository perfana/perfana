'use client';

import React from 'react';
import { Button, Tooltip } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { CARD_LABELS, useComments } from './CommentsContext';
import { unreadCommentsLabel } from '@/lib/test-run-comments';

/**
 * Run-level unread total (design R6/DR8). Each click reveals the first card in page order that
 * still has unread comments and opens its drawer, which marks it seen, so the next click moves on.
 * Not rendered at zero.
 */
export default function RunCommentsButton() {
  const ctx = useComments();
  if (!ctx || ctx.totalUnread === 0 || !ctx.nextUnreadCard) return null;
  const next = ctx.nextUnreadCard;
  const label = `${unreadCommentsLabel(ctx.totalUnread, ctx.totalUnreadAgent)} · next: ${CARD_LABELS[next]} (${ctx.unread[next]})`;
  return (
    <Tooltip title={label}>
      <Button
        size="small"
        variant="contained"
        color="error"
        disableElevation
        startIcon={<ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />}
        onClick={ctx.jumpToNextUnread}
        aria-label={label}
        data-testid="run-comments-button"
        sx={{ borderRadius: 4, minHeight: 32, textTransform: 'none' }}
      >
        {ctx.totalUnread}
      </Button>
    </Tooltip>
  );
}
