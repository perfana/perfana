'use client';

import React from 'react';
import {
  Box,
  Typography,
  IconButton,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Settings,
} from '@mui/icons-material';

interface CollapsedHeaderProps {
  accentColor: string;
  onExpand: () => void;
}

export function SLOCollapsedHeader({
  accentColor,
  onExpand,
}: CollapsedHeaderProps) {
  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      mb={2}
      position="relative"
    >
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
        Service Level Objectives
      </Typography>
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        size="small"
        sx={{
          position: 'absolute',
          right: 0,
          width: 32,
          height: 32,
          color: 'text.secondary',
          '&:hover': {
            backgroundColor: `${accentColor}15`,
            color: accentColor,
          },
          transition: 'all 0.2s ease',
        }}
      >
        <ExpandMore />
      </IconButton>
    </Box>
  );
}

interface ExpandedHeaderProps {
  testRun: unknown;
  onCollapse: () => void;
}

export function SLOExpandedHeader({
  testRun,
  onCollapse,
}: ExpandedHeaderProps) {
  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      sx={{
        cursor: 'pointer',
        py: 1,
        px: 1,
        mx: -1,
        borderRadius: 2,
        transition: 'background-color 0.2s ease',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
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
          Service Level Objectives
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Click to collapse
        </Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={1} sx={{ position: 'absolute', right: 0 }}>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            if (testRun) {
              const configUrl = `/systems/${testRun.system_under_test_id}/config?tab=slo&environment=${encodeURIComponent(testRun.test_environment)}&workload=${encodeURIComponent(testRun.workload || '')}`;
              window.open(configUrl, '_blank');
            }
          }}
          aria-label="slo settings"
          title="Open system configuration Service Level Objectives tab in new tab"
          sx={{
            width: 36,
            height: 36,
            '&:hover': {
              backgroundColor: 'action.hover'
            }
          }}
        >
          <Settings fontSize="small" />
        </IconButton>
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          size="medium"
          sx={{
            width: 40,
            height: 40,
            backgroundColor: 'action.hover',
            '&:hover': {
              backgroundColor: 'primary.main',
              color: 'primary.contrastText',
            },
            transition: 'all 0.2s ease'
          }}
        >
          <ExpandLess />
        </IconButton>
      </Box>
    </Box>
  );
}
