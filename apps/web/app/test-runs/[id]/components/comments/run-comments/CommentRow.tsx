'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
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

/** Longest investigation title a chip shows before it is cut with an ellipsis. */
export const STORY_CHIP_TITLE_MAX = 32;
/** How many "In: …" chips a row shows before the rest fold into "+N". */
const STORY_CHIPS_SHOWN = 2;

const clip = (title: string) => (title.length > STORY_CHIP_TITLE_MAX ? `${title.slice(0, STORY_CHIP_TITLE_MAX - 1).trimEnd()}…` : title);

/**
 * "In: <investigation>" per investigation the root is a step of (as far as the caller can see them),
 * two at most and then "+N". A chip opens that investigation in the reader.
 */
export function StoryChips({ stories, onRead }: { stories: NonNullable<RunCommentThread['stories']>; onRead?: (id: string) => void }) {
  if (stories.length === 0) return null;
  const shown = stories.slice(0, STORY_CHIPS_SHOWN);
  const rest = stories.slice(STORY_CHIPS_SHOWN);
  return (
    <Box component="span" data-testid="run-comments-row-stories" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
      {shown.map((st) => (
        <Chip
          key={st.id}
          size="small"
          variant="outlined"
          color="info"
          label={`In: ${clip(st.title)}`}
          title={st.title}
          aria-label={`Read the investigation ${st.title} (step ${st.position})`}
          onClick={onRead ? () => onRead(st.id) : undefined}
          sx={{ maxWidth: '100%' }}
        />
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map((st) => st.title).join(', ')}>
          <Chip size="small" variant="outlined" label={`+${rest.length}`} aria-label={`In ${rest.length} more ${rest.length === 1 ? 'investigation' : 'investigations'}: ${rest.map((st) => st.title).join(', ')}`} />
        </Tooltip>
      )}
    </Box>
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
  unread = false,
  onReadStory,
}: {
  thread: RunCommentThread;
  tagSelected: (tag: CommentTag) => boolean;
  onTag: (tag: CommentTag) => void;
  onShow: () => void;
  /** The root or a reply under it is unread for the caller (the counts' rule). */
  unread?: boolean;
  onReadStory?: (storyId: string) => void;
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
      data-unread={unread ? 'true' : undefined}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1, py: 1.25, borderTop: 1, borderColor: 'divider' }}
    >
      <Box sx={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, minWidth: 0 }}>
          {unread && (
            <Box
              component="span"
              role="img"
              aria-label="Unread"
              data-testid="run-comments-unread-dot"
              sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 }}
            />
          )}
          {tag && <CommentTagChip tag={tag} selected={tagSelected(tag)} onClick={() => onTag(tag)} />}
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>{card}</Typography>
          {anchor && (
            <Typography variant="body2" sx={{ color: 'readable.primary', fontWeight: 500, overflowWrap: 'anywhere', minWidth: 0 }}>
              {anchor}
            </Typography>
          )}
          <CommentAuthorLine thread={t} />
          {t.stories && t.stories.length > 0 && <StoryChips stories={t.stories} onRead={onReadStory} />}
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
