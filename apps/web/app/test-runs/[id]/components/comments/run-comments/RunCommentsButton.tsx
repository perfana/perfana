'use client';

import React, { useEffect, useState } from 'react';
import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { fetchStories } from '@/lib/test-run-stories';
import { useComments } from '../CommentsContext';
import { RunCommentsDialog } from './RunCommentsDialog';

/** "Comments: 12, 3 unread" (or "Comments: 2 stories" on a run whose comments were all deleted). */
export function runCommentsLabel(total: number, unread: number, stories: number): string {
  const parts = [`${total}`];
  if (unread > 0) parts.push(`${unread} unread`);
  if (total === 0 && stories > 0) return `Comments: ${stories} ${stories === 1 ? 'story' : 'stories'}`;
  return `Comments: ${parts.join(', ')}`;
}

/**
 * The run header's comments icon: the run's comment total as a badge, red while comments by others
 * are unread, opening the Comments dialog. Shown when the run has comments, and also when it has
 * stories only, so they stay reachable. Stories are counted from the access-checked list (drafts:
 * the caller's own), refetched on `story:changed`.
 */
export default function RunCommentsButton() {
  const ctx = useComments();
  const [open, setOpen] = useState(false);
  const [stories, setStories] = useState(0);
  const runId = ctx?.runId;
  const storySeq = ctx?.storyEvent?.seq ?? 0;
  useEffect(() => {
    if (!runId) return;
    let live = true;
    fetchStories(runId)
      .then((s) => live && setStories(s.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runId, storySeq]);

  if (!ctx) return null;
  const total = Object.values(ctx.counts).reduce((a, c) => a + (c?.total ?? 0), 0);
  const unread = ctx.totalUnread;
  if (total === 0 && stories === 0 && !open) return null;
  const label = runCommentsLabel(total, unread, stories);
  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          aria-haspopup="dialog"
          data-testid="run-comments-button"
          onClick={() => setOpen(true)}
          color={unread > 0 ? 'error' : 'default'}
        >
          <Badge
            badgeContent={total}
            color={unread > 0 ? 'error' : 'default'}
            max={999}
            data-testid="run-comments-badge"
            sx={unread > 0 ? undefined : { '& .MuiBadge-badge': { bgcolor: 'action.selected', color: 'text.primary' } }}
          >
            <ChatBubbleOutlineIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <RunCommentsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
