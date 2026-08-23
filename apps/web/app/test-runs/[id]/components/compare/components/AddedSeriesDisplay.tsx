'use client';

import React from 'react';
import { Box, Typography, Button, Chip, Collapse, Link } from '@mui/material';
import { Close } from '@mui/icons-material';
import { CompareSeries } from '../types/compare.types';

interface AddedSeriesDisplayProps {
  addedSeries: CompareSeries[];
  onRemoveSeries: (seriesId: string) => void;
  onClearAll: () => void;
}

// Collapse the chip list once it grows past this; ~2 rows stay visible.
const COLLAPSE_THRESHOLD = 8;
const COLLAPSED_HEIGHT = 76;

export default function AddedSeriesDisplay({
  addedSeries,
  onRemoveSeries,
  onClearAll
}: AddedSeriesDisplayProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (addedSeries.length === 0) {
    return null;
  }

  const collapsible = addedSeries.length > COLLAPSE_THRESHOLD;

  // Group chips by dashboard, preserving first-seen order.
  const byDashboard = new Map<string, CompareSeries[]>();
  for (const series of addedSeries) {
    const list = byDashboard.get(series.dashboardLabel);
    if (list) list.push(series);
    else byDashboard.set(series.dashboardLabel, [series]);
  }

  const chips = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {[...byDashboard].map(([dashboardLabel, series]) => (
        <Box key={dashboardLabel}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 0.5 }}>
            {dashboardLabel}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {series.map((s) => (
              <Chip
                key={s.id}
                label={`${s.panelTitle} → ${s.metricName}`}
                onDelete={() => onRemoveSeries(s.id)}
                deleteIcon={<Close fontSize="small" />}
                // Default chip: the selection panel's chips just lost the same gradient, and two
                // chip languages in one view was the reason to drop it.
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );

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
      {collapsible ? (
        <Collapse in={expanded} collapsedSize={COLLAPSED_HEIGHT}>{chips}</Collapse>
      ) : chips}
      {collapsible && (
        <Link component="button" variant="body2" underline="hover" onClick={() => setExpanded(e => !e)}
          sx={{ mt: 1, display: 'inline-block' }}>
          {expanded ? 'Show less' : `Show all ${addedSeries.length}`}
        </Link>
      )}
    </Box>
  );
}
