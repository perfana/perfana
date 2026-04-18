'use client';

import React from 'react';
import { Grid, Typography } from '@mui/material';
import { formatValueWithUnit } from '@/lib/units';
import { TrackedRegression } from '../types';

interface ValueComparisonProps {
  regression: TrackedRegression;
}

export const ValueComparison: React.FC<ValueComparisonProps> = ({ regression }) => {
  const severityColor = Math.abs(regression.percentageChange) > 10 ? 'error' : 'warning';

  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid size={{ xs: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Baseline Value
        </Typography>
        <Typography variant="h6">
          {formatValueWithUnit(regression.baselineValue, regression.unit)}
        </Typography>
      </Grid>
      <Grid size={{ xs: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Current Value
        </Typography>
        <Typography variant="h6" color={severityColor}>
          {formatValueWithUnit(regression.currentValue, regression.unit)}
        </Typography>
      </Grid>
      <Grid size={{ xs: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Change
        </Typography>
        <Typography variant="h6" color={severityColor}>
          {regression.percentageChange > 0 ? '+' : ''}{regression.percentageChange.toFixed(1)}%
        </Typography>
      </Grid>
    </Grid>
  );
};
