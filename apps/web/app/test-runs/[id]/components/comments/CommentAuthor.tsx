'use client';

import React from 'react';
import { Box, Tooltip, Typography, type TypographyProps } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { CommentAuthorKind } from '@perfana/shared/constants/comment-cards';

/**
 * A small "AI" mark beside an agent's name (design: test-run-analysis-stories.md, "Marking agent
 * content"): a reader must never mistake an agent's claim for a colleague's. Text in the
 * mode-correct `readable` shade; the tint is `alpha()` of the opaque `.main`, never of a
 * translucent token (apps/web/CLAUDE.md, "Two colour bugs").
 */
export function AiAuthorChip() {
  return (
    <Tooltip title="Written by an AI agent through an API key">
      <Box
        component="span"
        data-testid="comment-author-ai"
        sx={{
          px: 0.5,
          borderRadius: 0.5,
          fontSize: '0.6875rem',
          fontWeight: 700,
          lineHeight: 1.5,
          letterSpacing: '0.02em',
          color: 'readable.info',
          bgcolor: (theme) => alpha(theme.palette.info.main, 0.14),
          flexShrink: 0,
        }}
      >
        AI
      </Box>
    </Tooltip>
  );
}

/**
 * A comment's author as every comments surface shows it: the stored name, plus the AI chip when
 * an agent wrote it. The name is plain text (React escapes it), like any author's.
 */
export default function CommentAuthor({
  name,
  kind,
  variant = 'body2',
  sx,
  noWrap,
}: {
  name: string;
  kind?: CommentAuthorKind | null;
  variant?: TypographyProps['variant'];
  sx?: TypographyProps['sx'];
  noWrap?: boolean;
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Typography component="span" variant={variant} noWrap={noWrap} sx={sx}>
        {name}
      </Typography>
      {kind === 'agent' && <AiAuthorChip />}
    </Box>
  );
}
