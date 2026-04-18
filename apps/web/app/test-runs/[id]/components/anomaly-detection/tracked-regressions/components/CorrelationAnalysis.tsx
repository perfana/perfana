'use client';

import React from 'react';
import {
  Box, Grid, Typography, Chip,
  FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningIcon from '@mui/icons-material/Warning';
import { TrackedRegression } from '../types';

interface CorrelationAnalysisProps {
  regression: TrackedRegression;
  correlatedRegressions: TrackedRegression[];
  selectedMetric: string;
  onMetricChange: (metricName: string) => void;
}

export const CorrelationAnalysis: React.FC<CorrelationAnalysisProps> = ({
  regression,
  correlatedRegressions,
  selectedMetric,
  onMetricChange,
}) => {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
        Correlation Analysis
      </Typography>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Select Metric to Analyze</InputLabel>
            <Select
              value={selectedMetric}
              label="Select Metric to Analyze"
              onChange={(e) => onMetricChange(e.target.value)}
            >
              <MenuItem value={regression.metricName}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TrendingUpIcon color="warning" fontSize="small" />
                  <strong>{regression.metricName}</strong>
                  <Chip label="Tracked" size="small" color="warning" />
                </Box>
              </MenuItem>

              {correlatedRegressions.map(correlated => (
                <MenuItem key={correlated.metricName} value={correlated.metricName}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningIcon color="error" fontSize="small" />
                    {correlated.metricName}
                    <Chip
                      label={`${correlated.percentageChange > 0 ? '+' : ''}${correlated.percentageChange.toFixed(1)}%`}
                      size="small"
                      color="error"
                    />
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
            Regressions Detected Together:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {correlatedRegressions.length === 0 ? (
              <Chip label="No other regressions detected" size="small" variant="outlined" />
            ) : (
              correlatedRegressions.map(correlated => (
                <Chip
                  key={correlated.metricName}
                  label={`${correlated.metricName} (${correlated.percentageChange > 0 ? '+' : ''}${correlated.percentageChange.toFixed(1)}%)`}
                  size="small"
                  color="error"
                  variant="outlined"
                  onClick={() => onMetricChange(correlated.metricName)}
                  sx={{ cursor: 'pointer' }}
                />
              ))
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};
