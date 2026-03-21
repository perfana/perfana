'use client';

import { Box, Typography, Chip, useTheme } from '@mui/material';
import { TestRun } from '@/types/test-runs';

interface TestConfigurationSectionProps {
  testRun: TestRun;
}

export function TestConfigurationSection({ testRun }: TestConfigurationSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(156, 39, 176, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: isDark ? '1px solid rgba(156, 39, 176, 0.15)' : '1px solid rgba(156, 39, 176, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#ce93d8' : '#9c27b0',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#e1bee7' : '#7b1fa2',
      }
    }}>
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: '#9c27b0',
          mb: 2.5,
        }}
      >
        Test Configuration
      </Typography>

      {/* System */}
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
          System Under Test
        </Typography>
        <Chip
          label={testRun.systems_under_test?.name || 'Unknown'}
          size="medium"
          sx={{
            height: '32px',
            backgroundColor: 'rgba(156, 39, 176, 0.08)',
            border: '1px solid rgba(156, 39, 176, 0.2)',
            color: '#9c27b0',
            fontWeight: 600,
            fontSize: '0.875rem',
            '& .MuiChip-label': {
              px: 1.5,
            }
          }}
        />
      </Box>

      {/* Environment */}
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
          Environment
        </Typography>
        <Chip
          label={testRun.test_environment}
          size="medium"
          sx={{
            height: '32px',
            backgroundColor: 'rgba(156, 39, 176, 0.08)',
            border: '1px solid rgba(156, 39, 176, 0.2)',
            color: '#9c27b0',
            fontWeight: 600,
            fontSize: '0.875rem',
            '& .MuiChip-label': {
              px: 1.5,
            }
          }}
        />
      </Box>

      {/* Workload */}
      <Box sx={{ mb: testRun.abort ? 2.5 : 0 }}>
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
          Workload
        </Typography>
        <Chip
          label={testRun.workload}
          size="medium"
          sx={{
            height: '32px',
            backgroundColor: 'rgba(156, 39, 176, 0.08)',
            border: '1px solid rgba(156, 39, 176, 0.2)',
            color: '#9c27b0',
            fontWeight: 600,
            fontSize: '0.875rem',
            '& .MuiChip-label': {
              px: 1.5,
            }
          }}
        />
      </Box>

      {/* Abort Status (conditional) */}
      {testRun.abort && (
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
            Test Aborted
          </Typography>
          <Chip
            label="Yes - Test was aborted"
            size="medium"
            sx={{
              height: '32px',
              backgroundColor: 'rgba(244, 67, 54, 0.08)',
              border: '1px solid rgba(244, 67, 54, 0.3)',
              color: '#f44336',
              fontWeight: 600,
              fontSize: '0.875rem',
              '& .MuiChip-label': {
                px: 1.5,
              }
            }}
          />
        </Box>
      )}
    </Box>
  );
}
