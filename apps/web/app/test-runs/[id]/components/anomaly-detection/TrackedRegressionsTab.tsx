'use client';

import React from 'react';
import { Box, Grid, Alert, AlertTitle, CircularProgress } from '@mui/material';

// Tracked regressions module
import {
  TrackedRegressionsTabProps,
  useTrackedRegressionsData,
  TrackedRegressionCard,
} from './tracked-regressions';

export const TrackedRegressionsTab: React.FC<TrackedRegressionsTabProps> = ({
  testRunId,
  testRun,
  system,
  environment,
  workload,
  onNotification = () => {},
  showToast = () => {},
}) => {
  // Use the data hook for state management and API calls
  const {
    trackedRegressions,
    loading,
    expandedCards,
    correlatedRegressions,
    selectedMetrics,
    resolving,
    handleResolution,
    toggleCardExpansion,
    handleMetricChange,
    getChartData,
  } = useTrackedRegressionsData({
    testRunId,
    testRun,
    system,
    environment,
    workload,
    onNotification,
    showToast,
  });

  // Loading state
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Empty state
  if (trackedRegressions.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="success">
          <AlertTitle>No Unresolved Regressions</AlertTitle>
          All performance regressions have been resolved or no regressions are currently being tracked.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Summary Alert */}
      <Alert severity="warning" sx={{ mb: 3 }}>
        <AlertTitle>Unresolved Regressions Require Attention</AlertTitle>
        These performance regressions were detected in previous test runs and are still present.
        They require explicit resolution to prevent baseline degradation.
        <strong> {trackedRegressions.length} unresolved regression(s) found.</strong>
      </Alert>

      {/* Tracked Regressions List - Ordered by Date (Oldest First) */}
      <Grid container spacing={2}>
        {trackedRegressions.map((regression, index) => (
          <Grid item xs={12} key={regression.id}>
            <TrackedRegressionCard
              regression={regression}
              expanded={expandedCards[regression.id] || false}
              onToggle={() => toggleCardExpansion(regression.id)}
              onResolve={handleResolution}
              isOldest={index === 0}
              position={index + 1}
              totalCount={trackedRegressions.length}
              correlatedRegressions={correlatedRegressions[regression.id] || []}
              selectedMetric={selectedMetrics[regression.id] || regression.metricName}
              onMetricChange={(metricName) => handleMetricChange(regression.id, metricName)}
              chartData={getChartData(regression.id)}
              resolving={resolving[regression.id] || false}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

// Re-export types for external use
export type { TrackedRegressionsTabProps, TrackedRegression } from './tracked-regressions';
