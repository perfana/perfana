'use client';

import React from 'react';
import TrackedRegressionsView from '../../TrackedRegressionsView';
import type { TrackedRegressionsTabContentProps } from '../types';

/**
 * Content component for the Tracked Regressions tab.
 * Wraps the TrackedRegressionsView with proper callback handling.
 */
export function TrackedRegressionsTabContent({
  testRunId,
  testRun,
  trendsData,
  onRefreshAnomalyData,
  showToast,
}: TrackedRegressionsTabContentProps) {
  return (
    <TrackedRegressionsView
      testRunId={testRunId}
      testRun={testRun}
      trendsData={trendsData}
      showToast={showToast}
      onResolve={(trackedTestRunId, resolution) => {
        showToast(`Successfully marked test run ${trackedTestRunId} as ${resolution}`);
        onRefreshAnomalyData?.();
      }}
      onMarkChangepoint={(trackedTestRunId) => {
        showToast(`Successfully marked test run ${trackedTestRunId} as changepoint and triggered re-evaluation`);
        onRefreshAnomalyData?.();
      }}
    />
  );
}
