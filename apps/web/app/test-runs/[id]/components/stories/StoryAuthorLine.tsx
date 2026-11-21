'use client';

import React from 'react';
import Box from '@mui/material/Box';
import type { RunStorySummary } from '@/lib/test-run-stories';
import CommentAuthor from '../comments/CommentAuthor';

/**
 * The label an agent's unpublished story carries everywhere (design: "Agent stories are proposals,
 * and a human publishes them"): nobody has vouched for its claims yet.
 */
export const AI_DRAFT_LABEL = 'AI draft · not reviewed';

type StoryWho = Pick<RunStorySummary, 'status' | 'authorName' | 'authorKind' | 'publishedByName'>;

/** "Published", "Draft", or for an agent's draft `AI draft · not reviewed`. */
export function storyStatusLabel(s: Pick<StoryWho, 'status' | 'authorKind'>): string {
  if (s.status === 'published') return 'Published';
  return s.authorKind === 'agent' ? AI_DRAFT_LABEL : 'Draft';
}

/** Plain-text attribution, for an aria label or a tooltip: what `StoryAuthorLine` shows. */
export function storyAttribution(s: StoryWho): string {
  if (s.authorKind !== 'agent') return s.authorName;
  if (s.status === 'published') return `Proposed by ${s.authorName} (AI) · reviewed and published by ${s.publishedByName ?? 'a reviewer'}`;
  return `${s.authorName} (AI)`;
}

/**
 * Who a story is by. A user's story names its author; an agent's carries the AI chip, and once a
 * person published it, reads `Proposed by <agent> · reviewed and published by <user>`, because that
 * person took responsibility for it. Names are plain text (React escapes them).
 */
export function StoryAuthorLine({ story }: { story: StoryWho }) {
  if (story.authorKind !== 'agent') return <>{story.authorName}</>;
  const agent = <CommentAuthor name={story.authorName} kind="agent" variant="inherit" />;
  if (story.status !== 'published') return agent;
  return (
    // Inline, not flex: real spaces between the parts, so it reads and copies as a sentence.
    <Box component="span" data-testid="story-proposed-by">
      Proposed by {agent} · reviewed and published by {story.publishedByName ?? 'a reviewer'}
    </Box>
  );
}
