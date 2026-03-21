'use client';

import React from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import { Close } from '@mui/icons-material';
import { CompareSeries } from '../types/compare.types';

interface AddedSeriesDisplayProps {
  addedSeries: CompareSeries[];
  onRemoveSeries: (seriesId: string) => void;
  onClearAll: () => void;
}

export default function AddedSeriesDisplay({
  addedSeries,
  onRemoveSeries,
  onClearAll
}: AddedSeriesDisplayProps) {
  if (addedSeries.length === 0) {
    return null;
  }

  return (
    <Box sx={{
      p: 2,
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 2,
      backgroundColor: 'action.hover',
      mb: 2
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Added Series ({addedSeries.length})
        </Typography>
        <Button
          size="small"
          color="error"
          onClick={onClearAll}
          startIcon={<Close fontSize="small" />}
        >
          Clear All
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {addedSeries.map((series) => (
          <Chip
            key={series.id}
            label={`${series.panelTitle} → ${series.metricName}`}
            onDelete={() => onRemoveSeries(series.id)}
            deleteIcon={<Close fontSize="small" />}
            sx={(theme) => ({
              background: theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(30, 136, 229, 0.24) 100%)'
                : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
              border: theme.palette.mode === 'dark'
                ? '1px solid rgba(56, 142, 232, 0.5)'
                : '1px solid rgba(25, 118, 210, 0.3)',
              color: theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
              '& .MuiChip-deleteIcon': {
                color: theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.main,
                '&:hover': {
                  color: theme.palette.error.main,
                }
              }
            })}
          />
        ))}
      </Box>
    </Box>
  );
}
