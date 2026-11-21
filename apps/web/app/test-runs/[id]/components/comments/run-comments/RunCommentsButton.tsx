'use client';

import React, { useEffect, useState } from 'react';
import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { fetchStories } from '@/lib/test-run-stories';
import { useComments } from '../CommentsContext';
import { RunCommentsDialog } from './RunCommentsDialog';
import { unreadCommentsLabel } from '@/lib/test-run-comments';

/**
 * "Comments: 12, 3 unread (1 from AI) · Investigations: 1 unread" (or "Comments: 2 investigations"
 * on a run whose comments were all deleted). The investigations part appears only when one is
 * unread.
 */
export function runCommentsLabel(total: number, unread: number, stories: number, unreadFromAgents = 0, storiesUnread = 0): string {
  const parts = [`${total}`];
  if (unread > 0) parts.push(unreadCommentsLabel(unread, unreadFromAgents));
  const head =
    total === 0 && stories > 0
      ? `Comments: ${stories} ${stories === 1 ? 'investigation' : 'investigations'}`
      : `Comments: ${parts.join(', ')}`;
  return storiesUnread > 0 ? `${head} · Investigations: ${storiesUnread} unread` : head;
}

/**
 * The run header's comments icon: the run's comment total as a badge, red while comments by others
 * or an investigation are unread, opening the Comments dialog. Shown when the run has comments, and
 * also when it has investigations only, so they stay reachable. Investigations are counted from the
 * access-checked list (drafts: the caller's own and every AI agent's, so a run whose only content is
 * an agent's proposed investigation still shows the icon), which also says which are unread: one
 * request per page load, refetched on `story:changed` and when the reader marks one read.
 */
export default function RunCommentsButton() {
  const ctx = useComments();
  const [open, setOpen] = useState(false);
  const [stories, setStories] = useState({ total: 0, unread: 0 });
  const runId = ctx?.runId;
  const storySeq = ctx?.storyEvent?.seq ?? 0;
  const readSeq = ctx?.storyReadSeq ?? 0;
  useEffect(() => {
    if (!runId) return;
    let live = true;
    fetchStories(runId)
      .then((s) => live && setStories({ total: s.length, unread: s.filter((x) => x.unread).length }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runId, storySeq, readSeq]);

  if (!ctx) return null;
  const total = Object.values(ctx.counts).reduce((a, c) => a + (c?.total ?? 0), 0);
  const unread = ctx.totalUnread;
  if (total === 0 && stories.total === 0 && !open) return null;
  const label = runCommentsLabel(total, unread, stories.total, ctx.totalUnreadAgent, stories.unread);
  const anyUnread = unread > 0 || stories.unread > 0;
  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          aria-haspopup="dialog"
          data-testid="run-comments-button"
          onClick={() => setOpen(true)}
          color={anyUnread ? 'error' : 'default'}
        >
          <Badge
            badgeContent={total}
            color={anyUnread ? 'error' : 'default'}
            max={999}
            data-testid="run-comments-badge"
            sx={anyUnread ? undefined : { '& .MuiBadge-badge': { bgcolor: 'action.selected', color: 'text.primary' } }}
          >
            <ChatBubbleOutlineIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <RunCommentsDialog open={open} onClose={() => setOpen(false)} storiesUnread={stories.unread} />
    </>
  );
}
