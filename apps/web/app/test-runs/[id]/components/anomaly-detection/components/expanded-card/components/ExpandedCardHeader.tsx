'use client';

import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { ExpandLess } from '@mui/icons-material';
import type { ExpandedCardHeaderProps } from '../types';

/**
 * Header component for the expanded anomaly detection card.
 * Includes title, subtitle, and collapse button.
 */
export function ExpandedCardHeader({ onCollapse }: ExpandedCardHeaderProps) {
  return (
    <Box
      sx={{
        px: 3,
        py: 0.75,
        borderRadius: 2,
        transition: 'background-color 0.2s ease',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        '&:hover': {
          backgroundColor: 'action.hover'
        }
      }}
      onClick={onCollapse}
    >
      <Box textAlign="center">
        <Typography
          variant="h5"
          component="h2"
          sx={{
            fontWeight: 600,
            color: 'text.primary',
            fontSize: '1.125rem',
            letterSpacing: 'normal',
            lineHeight: 1.2
          }}
        >
          Anomaly Detection Results
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Click to collapse
        </Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={1} sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          size="small"
          sx={{
            '&:hover': {
              backgroundColor: 'action.hover'
            }
          }}
        >
          <ExpandLess />
        </IconButton>
      </Box>
    </Box>
  );
}
