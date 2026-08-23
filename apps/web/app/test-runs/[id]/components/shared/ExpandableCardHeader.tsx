'use client';

import React from 'react';
import { Box, Typography, IconButton, Tooltip, alpha } from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';

interface ExpandableCardHeaderProps {
  /** Card title, also used to build the icon button's aria-label. */
  title: string;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The header shared by the Compare, Trends and Graphs cards.
 *
 * Collapsed: a small uppercase caption with an expand button.
 * Expanded: a sticky, translucent strip that floats over the chart while
 * scrolling, with a collapse button. Clicking anywhere on it collapses the card.
 *
 * Before this existed the same ~55 lines were pasted into all three cards, so the
 * next tweak to one of them silently drifted from the other two.
 */
export default function ExpandableCardHeader({
  title,
  expanded,
  onToggle,
}: ExpandableCardHeaderProps) {
  const lowerTitle = title.toLowerCase();
  const toggleFromButton = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  if (!expanded) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" mb={2} position="relative">
        <Typography
          variant="subtitle1"
          component="h2"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            fontSize: '0.875rem',
            letterSpacing: '0.01em',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          {title}
        </Typography>
        <Tooltip title="Expand">
          <IconButton
            aria-label={`Expand ${lowerTitle}`}
            onClick={toggleFromButton}
            size="small"
            sx={{
              position: 'absolute',
              right: 0,
              width: 32,
              height: 32,
              color: 'text.secondary',
              // action.selected rather than a hardcoded primary+alpha: it tracks the
              // theme in dark mode, where a fixed tint was almost invisible.
              '&:hover': { backgroundColor: 'action.selected', color: 'primary.main' },
              transition: 'all 0.2s ease',
            }}
          >
            <ExpandMore />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      sx={{
        cursor: 'pointer',
        py: 1,
        px: 1.25,
        mx: -1.25,
        borderRadius: 2,
        transition: 'background-color 0.2s ease',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        // ponytail: translucent + short so it reads as chrome floating over the
        // chart rather than a solid strip cut out of it while scrolling
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:hover': { backgroundColor: 'action.hover' },
      }}
      onClick={onToggle}
    >
      <Typography
        variant="h6"
        component="h2"
        sx={{ fontWeight: 600, color: 'text.primary', fontSize: '1rem', lineHeight: 1.4 }}
      >
        {title}
      </Typography>
      <Tooltip title="Collapse">
        <IconButton
          aria-label={`Collapse ${lowerTitle}`}
          onClick={toggleFromButton}
          size="small"
          sx={{
            position: 'absolute',
            right: 0,
            backgroundColor: 'action.hover',
            '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText' },
            transition: 'all 0.2s ease',
          }}
        >
          <ExpandLess />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * `onEntered` handler for the Collapse that wraps a Plotly chart.
 *
 * Plotly's `useResizeHandler` only listens to window resize, so a chart mounted
 * mid-animation keeps the width it measured then and its hover tooltips sit
 * misaligned. One synthetic resize once the Collapse settles fixes it.
 */
export const kickPlotlyResize = () => window.dispatchEvent(new Event('resize'));
