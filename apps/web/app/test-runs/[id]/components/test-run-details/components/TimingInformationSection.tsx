'use client';

import { Box, Typography, Divider, useTheme } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { formatDuration } from '../utils/test-run-formatters';

interface TimingInformationSectionProps {
  testRun: TestRun;
}

export function TimingInformationSection({ testRun }: TimingInformationSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(76, 175, 80, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: isDark ? '1px solid rgba(76, 175, 80, 0.15)' : '1px solid rgba(76, 175, 80, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#81c784' : '#4caf50',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#a5d6a7' : '#388e3c',
      }
    }}>
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: '#4caf50',
          mb: 2.5,
        }}
      >
        Timing Information
      </Typography>

      {/* Duration */}
      <Box sx={{ mb: 2.5 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          Total Duration
        </Typography>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}>
          <Typography
            variant="h6"
            sx={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'text.primary',
              lineHeight: 1,
              fontFamily: '"SF Mono", "Monaco", monospace',
            }}
          >
            {formatDuration(testRun.duration)}
          </Typography>
        </Box>
      </Box>

      {/* Ramp Up Period */}
      <Box sx={{ mb: 2.5 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          Ramp Up Period
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: 'text.primary',
            lineHeight: 1.4,
          }}
        >
          {formatDuration(testRun.ramp_up)}
        </Typography>
      </Box>

      <Divider sx={{ my: 2, opacity: 0.4 }} />

      {/* Start Time */}
      <Box sx={{ mb: 2.5 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          Start Time
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: 'text.primary',
            lineHeight: 1.4,
          }}
        >
          {testRun.start_time ? new Date(testRun.start_time).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }) : (
            <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>
          )}
        </Typography>
      </Box>

      {/* End Time */}
      <Box>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          End Time
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: 'text.primary',
            lineHeight: 1.4,
          }}
        >
          {testRun.end_time ? new Date(testRun.end_time).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }) : (
            <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>
          )}
        </Typography>
      </Box>
    </Box>
  );
}
