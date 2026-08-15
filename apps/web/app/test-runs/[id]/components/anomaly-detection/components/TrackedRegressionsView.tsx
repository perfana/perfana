'use client';

import React, { useState, useEffect } from 'react';
import { Box, Typography, Alert, CircularProgress, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import TrackedRegressionSection from './TrackedRegressionSection';
import { useBatchReevaluation } from '../hooks/useBatchReevaluation';
import { useUpdateAdaptConfig } from '../hooks/useUpdateAdaptConfig';

interface TrackedRegression {
  id: string;
  testRunId: string;
  trackedTestRunId: string;
  metricName: string;
  applicationDashboardId?: string;
  panelId?: string;
  dashboardLabel?: string;
  panelTitle?: string;
  unit?: string;
  testRunStart: Date;
  updatedAt: Date;
  conclusion?: { label?: string; [key: string]: unknown };
  /** Set once the regression has been re-evaluated on a later run. */
  trackedConclusion?: { resolved?: boolean; label?: string; [key: string]: unknown };
}

interface GroupedTrackedRegressions {
  trackedTestRunId: string;
  testRunStart: string;
  regressions: TrackedRegression[];
  redetectionCount: number;
  isResolved: boolean;
  canResolve: boolean; // Based on chronological order
}

interface TrackedRegressionsViewProps {
  testRunId: string;
  testRun?: TestRun | null;
  onResolve?: (trackedTestRunId: string, resolution: string) => void;
  onMarkChangepoint?: (trackedTestRunId: string) => void;
  trendsData?: Record<string, unknown[]>;
  showToast?: (message: string) => void;
}

export default function TrackedRegressionsView({
  testRunId,
  testRun,
  onResolve,
  onMarkChangepoint,
  trendsData: _externalTrendsData,
  showToast = () => { /* noop */ },
}: TrackedRegressionsViewProps) {
  const theme = useTheme();
  const [groupedRegressions, setGroupedRegressions] = useState<GroupedTrackedRegressions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localTrendsData, setLocalTrendsData] = useState<Record<string, unknown[]>>({});

  const { triggerBatchReevaluation } = useBatchReevaluation({
    testRun,
    testRunId,
    showToast
  });

  const { updateAdaptConfig } = useUpdateAdaptConfig({
    testRun,
    showToast
  });

  const fetchTrackedRegressions = async () => {
    setLoading(true);
    setError(null);
    try {
      // Build query parameters including system, environment, and workload if available
      const queryParams = new URLSearchParams({
        testRunId: testRunId
      });

      if (testRun?.systems_under_test?.name) {
        queryParams.set('system', testRun.systems_under_test.name);
      }
      if (testRun?.test_environment) {
        queryParams.set('environment', testRun.test_environment);
      }
      if (testRun?.workload) {
        queryParams.set('workload', testRun.workload);
      }

      const response = await authenticatedFetch(`/adapt/tracked-regressions?${queryParams.toString()}`);
      if (response.ok) {
        const data = await response.json();
        await processAndGroupRegressions(data.regressions || []);
      } else {
        setError('Failed to load unresolved regressions');
      }
    } catch (err) {
      console.error('Error fetching tracked regressions:', err);
      setError('Error loading unresolved regressions');
    } finally {
      setLoading(false);
    }
  };

  const processAndGroupRegressions = async (regressions: TrackedRegression[]) => {
    // Check for potential data issues
    const uniqueTrackedTestRunIds = [...new Set(regressions.map(r => r.trackedTestRunId))];
    const _startDatesByTrackedId = Object.fromEntries(
      uniqueTrackedTestRunIds.map(id => [
        id,
        regressions
          .filter(r => r.trackedTestRunId === id)
          .map(r => r.testRunStart)
      ])
    );
    // Group by trackedTestRunId
    const grouped = regressions.reduce((acc, regression) => {
      const key = regression.trackedTestRunId;
      if (!acc[key]) {
        acc[key] = {
          trackedTestRunId: key,
          testRunStart: regression.testRunStart instanceof Date ? regression.testRunStart.toISOString() : String(regression.testRunStart),
          regressions: [],
          redetectionCount: 0,
          isResolved: false,
          canResolve: false,
        };
      } else {
        // Validate that all regressions in the same group have consistent testRunStart times
        const existingStart = acc[key].testRunStart;
        const newStart = regression.testRunStart instanceof Date ? regression.testRunStart.toISOString() : String(regression.testRunStart);
        if (existingStart !== newStart) {
          console.warn(`Data inconsistency detected for trackedTestRunId: ${key}. Existing start: ${existingStart}, new start: ${newStart}`);
        }
      }
      acc[key].regressions.push(regression);
      return acc;
    }, {} as Record<string, GroupedTrackedRegressions>);

    // Convert to array and sort chronologically (oldest first)
    const groupedArray = Object.values(grouped).sort((a, b) =>
      new Date(a.testRunStart).getTime() - new Date(b.testRunStart).getTime()
    );

    // Calculate redetection counts and resolution eligibility
    groupedArray.forEach((group, _index) => {
      // Count how many test runs have redetected these regressions
      const uniqueTestRuns = new Set(group.regressions.map(r => r.testRunId));
      group.redetectionCount = uniqueTestRuns.size;

      // Check if resolved (all regressions have been resolved via trackedConclusion)
      group.isResolved = group.regressions.every(r =>
        r.trackedConclusion?.resolved === true
      );
    });

    // Filter out resolved groups - only show unresolved regressions
    const unresolvedGroups = groupedArray.filter(group => !group.isResolved);

    // Update canResolve for unresolved groups only - can only resolve the oldest unresolved test run first
    unresolvedGroups.forEach((group, index) => {
      // Can only resolve if this is the first (oldest) unresolved group
      group.canResolve = index === 0;
    });

    setGroupedRegressions(unresolvedGroups);

    // Fetch trends data for all unique metrics (from unresolved groups only)
    await fetchTrendsDataForMetrics(unresolvedGroups);
  };

  const fetchTrendsDataForMetrics = async (groups: GroupedTrackedRegressions[]) => {
    try {
      // Get all unique metrics from all regressions
      const uniqueMetrics = new Set<string>();
      const metricDetails = new Map<string, { applicationDashboardId: string; panelId: string }>();

      groups.forEach(group => {
        group.regressions.forEach(regression => {
          if (regression.metricName) {
            uniqueMetrics.add(regression.metricName);
            // Store the details for the first occurrence of each metric
            if (!metricDetails.has(regression.metricName)) {
              const dashboardId = regression.applicationDashboardId || regression.testRunId;
              const panelId = regression.panelId || regression.testRunId;

              metricDetails.set(regression.metricName, {
                applicationDashboardId: dashboardId,
                panelId: panelId
              });
            }
          }
        });
      });

      // Fetch trends data for each metric
      const trendsPromises = Array.from(uniqueMetrics).map(async (metricName) => {
        try {
          const details = metricDetails.get(metricName);
          const queryParams = new URLSearchParams({
            applicationDashboardId: details?.applicationDashboardId || testRunId,
            panelId: details?.panelId || testRunId,
            metricName: metricName
          });

          const url = `/metrics/control-group-trends/${testRunId}?${queryParams.toString()}`;

          const response = await authenticatedFetch(url);

          if (response.ok) {
            const trendsData: Array<{ test_run_start: string }> = await response.json();
            trendsData.sort((a, b) => new Date(a.test_run_start).getTime() - new Date(b.test_run_start).getTime());
            return { metricName, data: trendsData };
          } else {
            console.warn(`Failed to fetch trends for metric: ${metricName}`);
            return { metricName, data: [] };
          }
        } catch (error) {
          console.error(`Error fetching trends for metric ${metricName}:`, error);
          return { metricName, data: [] };
        }
      });

      const results = await Promise.all(trendsPromises);

      // Build the trends data object keyed by metric name
      const newTrendsData: Record<string, unknown[]> = {};
      results.forEach(({ metricName, data }) => {
        newTrendsData[metricName] = data;
      });

      setLocalTrendsData(newTrendsData);
    } catch (error) {
      console.error('Error fetching trends data for metrics:', error);
    }
  };

  const handleResolve = async (trackedTestRunId: string, resolution: string) => {
    try {
      // Call API to resolve tracked regressions
      const response = await authenticatedFetch(`/adapt/tracked-regressions/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trackedTestRunId,
          resolution,
        }),
      });

      if (response.ok) {
        // Update adapt config for the tracked test run (where regressions were first detected)
        if (resolution === 'regression' || resolution === 'variability') {
          const adaptStatus = resolution === 'regression' ? 'DENIED' : 'ACCEPTED';
          await updateAdaptConfig(trackedTestRunId, adaptStatus);
        }

        // Refresh data
        await fetchTrackedRegressions();
        onResolve?.(trackedTestRunId, resolution);

        // Trigger batch re-evaluation for regression and variability resolutions
        // Use the trackedTestRunId (where regressions were first detected) as the base
        if (resolution === 'regression' || resolution === 'variability') {
          await triggerBatchReevaluation(trackedTestRunId);
        }
      } else {
        setError('Failed to resolve unresolved regressions');
      }
    } catch (err) {
      console.error('Error resolving tracked regressions:', err);
      setError('Error resolving unresolved regressions');
    }
  };

  const handleMarkChangepoint = async (trackedTestRunId: string) => {
    try {
      // First get the test run details to get system_under_test_id, test_environment, and workload
      const testRunResponse = await authenticatedFetch(`/test-runs/${trackedTestRunId}`);
      if (!testRunResponse.ok) {
        throw new Error('Failed to fetch test run details');
      }
      const testRunData = await testRunResponse.json();

      // Call API to mark as changepoint with complete payload
      const response = await authenticatedFetch(`/test-runs/mark-changepoint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemUnderTestId: testRunData.system_under_test_id,
          testEnvironment: testRunData.test_environment,
          workload: testRunData.workload,
          testRunId: trackedTestRunId,
        }),
      });

      if (response.ok) {
        // Refresh data
        await fetchTrackedRegressions();
        onMarkChangepoint?.(trackedTestRunId);
      } else {
        setError('Failed to mark changepoint');
      }
    } catch (err) {
      console.error('Error marking changepoint:', err);
      setError('Error marking changepoint');
    }
  };

  useEffect(() => {
    if (testRunId) {
      fetchTrackedRegressions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRunId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  if (groupedRegressions.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" color="text.secondary">
          No unresolved regressions found for this test run.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      {/* Explanatory text */}
      <Box sx={{ mb: 3, p: 2, backgroundColor: alpha(theme.palette.primary.main, 0.04), borderRadius: 2, border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}` }}>
        <Typography variant="body2" sx={{ mb: 1.5, color: 'text.primary' }}>
          <strong>Understanding Unresolved Regressions:</strong>
        </Typography>
        <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary', lineHeight: 1.6 }}>
          These are performance regressions that were detected in previous test runs and are being tracked across subsequent runs.
          Each regression represents a significant degradation in one or more metrics compared to the established baseline.
        </Typography>
        <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
              <strong style={{ color: theme.palette.error.main }}>Unresolved regressions</strong> indicate ongoing performance issues that need investigation
            </Typography>
          </Box>
          <Box component="li">
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
              Regressions must be resolved in chronological order to maintain baseline integrity
            </Typography>
          </Box>
        </Box>
        <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary', fontStyle: 'italic' }}>
          💡 Tip: Review the metrics in each regression to identify patterns and potential root causes before deciding on a resolution.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
        {groupedRegressions.map((group, index) => (
          <TrackedRegressionSection
            key={`tracked-regression-${group.trackedTestRunId}-${index}`}
            group={group}
            onResolve={handleResolve}
            onMarkChangepoint={handleMarkChangepoint}
            trendsData={localTrendsData}
          />
        ))}
      </Box>
    </Box>
  );
}