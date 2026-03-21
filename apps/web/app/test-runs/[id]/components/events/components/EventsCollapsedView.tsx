'use client';

import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import { PerfanaEvent } from '@/lib/events';

interface EventsCollapsedViewProps {
  events: PerfanaEvent[];
  loading: boolean;
}

export default function EventsCollapsedView({ events, loading }: EventsCollapsedViewProps) {
  const mostRecent = events.length > 0 ? events[0] : null;
  const manualCount = events.filter(e => !e.source || e.source === 'manual').length;
  const alertCount = events.filter(e => e.source && e.source !== 'manual').length;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" flex={1}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <KPIDisplay
          value={manualCount}
          label="Events"
          color={manualCount > 0 ? 'warning' : 'neutral'}
        />
        {alertCount > 0 && (
          <KPIDisplay
            value={alertCount}
            label="Alerts"
            color="error"
          />
        )}
      </Box>
      {mostRecent && (
        <Box sx={{ textAlign: 'center', mt: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem', color: 'text.primary' }} noWrap>
            {mostRecent.title}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
            {new Date(mostRecent.timestamp).toLocaleString()}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
