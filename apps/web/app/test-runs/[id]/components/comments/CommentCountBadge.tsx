'use client';

import React from 'react';
import { ButtonBase, Tooltip } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';

/**
 * The comment indicator shared by the run page's cards and the test-run list.
 * - unread > 0: red filled pill with the unread count;
 * - comments, none unread: neutral outlined pill with the total, always visible;
 * - no comments: a bare outlined icon (callers hide it until hover/focus via the
 *   `comment-count-badge--empty` class).
 */
export default function CommentCountBadge({
  total,
  unread,
  subject,
  onClick,
  className,
  testId,
}: {
  total: number;
  unread: number;
  /** "Graphs" / "this run": completes the tooltip and the accessible name. */
  subject: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  testId?: string;
}) {
  const state = unread > 0 ? 'unread' : total > 0 ? 'read' : 'empty';
  const label =
    state === 'unread'
      ? `${unread} unread comment${unread === 1 ? '' : 's'} on ${subject} (${total} in total)`
      : state === 'read'
        ? `${total} comment${total === 1 ? '' : 's'} on ${subject}`
        : `Comment on ${subject}`;
  const Icon = state === 'empty' ? ChatBubbleOutlineIcon : ChatBubbleIcon;
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={label}
        data-testid={testId}
        data-state={state}
        className={[className, state === 'empty' ? 'comment-count-badge--empty' : ''].filter(Boolean).join(' ')}
        onClick={onClick}
        sx={{
          minWidth: 28,
          height: 24,
          px: state === 'empty' ? 0 : 0.875,
          gap: 0.5,
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
          color: state === 'unread' ? 'error.contrastText' : 'text.secondary',
          bgcolor: state === 'unread' ? 'error.main' : 'background.paper',
          border: state === 'unread' ? 'none' : 1,
          borderColor: 'divider',
          '&:hover': { bgcolor: state === 'unread' ? 'error.dark' : 'action.hover' },
          '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', opacity: 1 },
        }}
      >
        <Icon sx={{ fontSize: 14 }} />
        {state !== 'empty' && <span>{state === 'unread' ? unread : total}</span>}
      </ButtonBase>
    </Tooltip>
  );
}
