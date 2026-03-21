'use client';

import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Settings,
} from '@mui/icons-material';

interface DistributedTracingHeaderProps {
  expanded: boolean;
  systemId: string;
  testEnvironment: string;
  workload: string;
  accentColorKey: 'error' | 'primary';
  onExpand: () => void;
}

export function DistributedTracingHeader({
  expanded,
  systemId,
  testEnvironment,
  workload,
  accentColorKey,
  onExpand,
}: DistributedTracingHeaderProps) {
  if (expanded) {
    return (
      <Box
        mb={2.5}
        sx={{
          py: 1,
          px: 1.25,
          mx: -1.25,
          borderRadius: 2,
          transition: 'background-color 0.2s ease',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          cursor: 'pointer',
          '&:hover': { backgroundColor: 'action.hover' },
        }}
        onClick={onExpand}
      >
        <Box textAlign="center">
          <Typography
            variant="h5"
            component="h2"
            sx={{
              fontWeight: 600,
              color: 'text.primary',
              fontSize: '1.25rem',
              lineHeight: 1.2,
            }}
          >
            Distributed Tracing
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click to collapse
          </Typography>
        </Box>
        <Tooltip title="Configure distributed tracing settings" placement="top">
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/systems/${systemId}/config?tab=tracing&environment=${encodeURIComponent(testEnvironment)}&workload=${encodeURIComponent(workload)}`, '_blank');
            }}
            size="medium"
            sx={{
              position: 'absolute',
              right: 48,
              backgroundColor: 'action.hover',
              '&:hover': {
                backgroundColor: 'primary.main',
                color: 'primary.contrastText',
              },
              transition: 'all 0.2s ease',
            }}
          >
            <Settings />
          </IconButton>
        </Tooltip>
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          size="medium"
          sx={{
            position: 'absolute',
            right: 0,
            backgroundColor: 'action.hover',
            '&:hover': {
              backgroundColor: 'primary.main',
              color: 'primary.contrastText',
            },
            transition: 'all 0.2s ease',
          }}
        >
          <ExpandLess />
        </IconButton>
      </Box>
    );
  }

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
        Distributed Tracing
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
            backgroundColor: (theme) => `${theme.palette[accentColorKey].main}15`,
            color: `${accentColorKey}.main`,
          },
          transition: 'all 0.2s ease',
        }}
      >
        <ExpandMore />
      </IconButton>
    </Box>
  );
}
