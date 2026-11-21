'use client';

import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';

/**
 * The bar above a card's list while it shows only the item a comment is about (design:
 * test-run-analysis-stories.md, "The comment filter"). "Show all" clears the comment filter;
 * the user's own filters were never changed, so they apply again as they were left.
 */
export default function CommentFilterChip({
  label,
  missing,
  onShowAll,
}: {
  /** What the item is called. */
  label: string;
  /** Set when the item is not in the card's data: said instead of "Showing the item…". */
  missing?: string | null;
  onShowAll: () => void;
}) {
  return (
    <Box
      role="status"
      data-testid="comment-filter-chip"
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
        mb: 2,
        px: 1.5,
        py: 0.5,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <ChatBubbleOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} aria-hidden />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {missing ?? (
          <>
            Showing the item from a comment:{' '}
            <Box component="span" sx={{ fontWeight: 600 }}>
              {label}
            </Box>
          </>
        )}
      </Typography>
      <Button size="small" onClick={onShowAll} sx={{ flexShrink: 0 }}>
        Show all
      </Button>
    </Box>
  );
}
