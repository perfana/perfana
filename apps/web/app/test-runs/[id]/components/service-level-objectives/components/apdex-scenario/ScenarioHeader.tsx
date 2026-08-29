'use client';

import React from 'react';
import { Box, Typography, Chip, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle, Error as ErrorIcon, ExpandMore, ChevronRight } from '@mui/icons-material';
import type { ScenarioHeaderProps } from '../../types';

export function ScenarioHeader({ scenario, transactionCount, failedCount, expanded, onToggle }: ScenarioHeaderProps) {
  const theme = useTheme();
  const hasFailed = failedCount > 0;
  const collapsible = onToggle !== undefined;

  return (
    <Box
      onClick={onToggle}
      // A clickable div is unreachable by keyboard; give it real button semantics when it acts as
      // one. MUI's Collapse is driven from `expanded`, so aria-expanded is the whole story here.
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? expanded : undefined}
      onKeyDown={
        collapsible
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle?.();
              }
            }
          : undefined
      }
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        mb: 1,
        px: 1,
        ...(collapsible && {
          cursor: 'pointer',
          borderRadius: '4px',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: 2 },
          '&:hover': { backgroundColor: alpha(theme.palette.secondary.main, 0.06) },
        }),
      }}
    >
      {collapsible && (expanded
        ? <ExpandMore sx={{ fontSize: 18, color: 'secondary.dark' }} />
        : <ChevronRight sx={{ fontSize: 18, color: 'secondary.dark' }} />)}
      <Typography variant="subtitle1" sx={{
        fontWeight: 700,
        color: 'secondary.dark',
        fontSize: '0.9rem',
        letterSpacing: '0.3px',
      }}>
        {scenario}
      </Typography>
      <Chip
        label={`${transactionCount} transaction${transactionCount !== 1 ? 's' : ''}`}
        size="small"
        sx={{
          backgroundColor: alpha(theme.palette.secondary.main, 0.1),
          color: 'secondary.main',
          fontWeight: 500,
          fontSize: '0.7rem',
          height: '20px',
        }}
      />
      {hasFailed ? (
        <Chip
          icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
          label={`${failedCount} failed`}
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            color: 'error.main',
            fontWeight: 600,
            fontSize: '0.7rem',
            height: '20px',
            '& .MuiChip-icon': { color: theme.palette.error.main }
          }}
        />
      ) : (
        <Chip
          icon={<CheckCircle sx={{ fontSize: '12px !important' }} />}
          label="All passed"
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.success.main, 0.1),
            color: 'success.main',
            fontWeight: 600,
            fontSize: '0.7rem',
            height: '20px',
            '& .MuiChip-icon': { color: theme.palette.success.main }
          }}
        />
      )}
    </Box>
  );
}
