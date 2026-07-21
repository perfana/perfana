'use client';

import { buildSystemConfigUrl } from '@/lib/system-config-url';
import { Box, Typography, Tooltip, IconButton } from '@mui/material';
import { ExpandMore, ExpandLess, Settings } from '@mui/icons-material';

interface PyroscopeHeaderProps {
  expanded: boolean;
  onExpand: () => void;
  testRunId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  accentColor: string;
}

export function PyroscopeHeader({
  expanded,
  onExpand,
  testRunId,
  systemUnderTestId,
  testEnvironment,
  workload,
  accentColor,
}: PyroscopeHeaderProps) {
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
            Pyroscope Profiling
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click to collapse
          </Typography>
        </Box>
        <Tooltip title="Configure Pyroscope settings" placement="top">
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              window.open(buildSystemConfigUrl({ systemId: systemUnderTestId, tab: 'pyroscope', environment: testEnvironment, workload, fromTestRun: testRunId }), '_blank');
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
        Pyroscope Profiling
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
