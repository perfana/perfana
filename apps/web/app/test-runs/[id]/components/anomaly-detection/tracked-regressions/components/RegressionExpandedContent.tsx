'use client';

import React from 'react';
import { Box } from '@mui/material';
import { TrackedRegression, PlotData } from '../types';
import { ValueComparison } from './ValueComparison';
import { CorrelationAnalysis } from './CorrelationAnalysis';
import { RegressionChart } from './RegressionChart';
import { AffectedTestRuns } from './AffectedTestRuns';
import { ResolutionHelpText } from './ResolutionHelpText';

interface RegressionExpandedContentProps {
  regression: TrackedRegression;
  correlatedRegressions: TrackedRegression[];
  selectedMetric: string;
  onMetricChange: (metricName: string) => void;
  chartData?: PlotData[];
  isOldest: boolean;
}

export const RegressionExpandedContent: React.FC<RegressionExpandedContentProps> = ({
  regression,
  correlatedRegressions,
  selectedMetric,
  onMetricChange,
  chartData,
  isOldest,
}) => {
  return (
    <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
      <ValueComparison regression={regression} />

      <CorrelationAnalysis
        regression={regression}
        correlatedRegressions={correlatedRegressions}
        selectedMetric={selectedMetric}
        onMetricChange={onMetricChange}
      />

      {chartData && (
        <RegressionChart
          chartData={chartData}
          selectedMetric={selectedMetric}
          unit={regression.unit}
        />
      )}

      <AffectedTestRuns testRunIds={regression.trackedTestRuns} />

      <ResolutionHelpText isOldest={isOldest} />
    </Box>
  );
};
