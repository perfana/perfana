'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { isCommentTag, type CommentTag } from '@perfana/shared/constants/comment-cards';
import { formatCommentTime, type RunCommentThread } from '@/lib/test-run-comments';
import { CARD_LABELS } from '../CommentsContext';
import { CommentTagChip } from '../CommentTagChip';
import CommentAuthor from '../CommentAuthor';
import { AddToStoryMenu } from '../../stories/AddToStoryMenu';

export const tagOf = (t: { tag?: unknown }): CommentTag | null => (isCommentTag(t.tag) ? t.tag : null);
/** What the root is on: its item, or its marker number on Graphs. */
export const anchorOf = (t: RunCommentThread): string | null =>
  t.itemLabel ?? (t.markerSeq != null ? `Marker ${t.markerSeq}` : null);

/** "Anna · 12 min ago" (with an AI chip for an agent): who wrote a root and when. One place, so an author marker lands once. */
export function CommentAuthorLine({ thread: t }: { thread: RunCommentThread }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
      <CommentAuthor name={t.authorName} kind={t.authorKind} variant="caption" /> · {formatCommentTime(t.createdAt)}
    </Typography>
  );
}

/**
 * One root in the run's All comments list: tag chip · card · item or marker · author and time ·
 * the first two lines · reply count, with Show in context and Add to story.
 */
export function CommentRow({
  thread: t,
  tagSelected,
  onTag,
  onShow,
}: {
  thread: RunCommentThread;
  tagSelected: (tag: CommentTag) => boolean;
  onTag: (tag: CommentTag) => void;
  onShow: () => void;
}) {
  const tag = tagOf(t);
  const anchor = anchorOf(t);
  const card = CARD_LABELS[t.cardKey] ?? t.cardKey;
  const where = anchor ? `${card} · ${anchor}` : card;
  return (
    <Box
      component="li"
      data-testid="run-comments-row"
      data-comment-id={t.id}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1, py: 1.25, borderTop: 1, borderColor: 'divider' }}
    >
      <Box sx={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, minWidth: 0 }}>
          {tag && <CommentTagChip tag={tag} selected={tagSelected(tag)} onClick={() => onTag(tag)} />}
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>{card}</Typography>
          {anchor && (
            <Typography variant="body2" sx={{ color: 'readable.primary', fontWeight: 500, overflowWrap: 'anywhere', minWidth: 0 }}>
              {anchor}
            </Typography>
          )}
          <CommentAuthorLine thread={t} />
        </Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            overflowWrap: 'anywhere', whiteSpace: 'pre-line', fontStyle: t.deleted ? 'italic' : 'normal',
          }}
        >
          {t.deleted ? 'Comment deleted' : t.body}
        </Typography>
        {t.replies.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flexShrink: 0 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={onShow}
          aria-label={`Show in context: ${t.authorName}'s comment on ${where}`}
          sx={{ flexShrink: 0, textTransform: 'none' }}
        >
          Show in context
        </Button>
        {!t.deleted && <AddToStoryMenu commentId={t.id} label={`Add ${t.authorName}'s comment on ${where} to a story`} />}
      </Box>
    </Box>
  );
}
