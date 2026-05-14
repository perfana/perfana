import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { TrackedRegression, PlotData } from '../types';
import { processTrackedRegressionData } from '../utils';
import { useBatchReevaluation } from '../../hooks/useBatchReevaluation';

interface UseTrackedRegressionsDataOptions {
  testRunId: string;
  testRun?: TestRun | null;
  system?: string;
  environment?: string;
  workload?: string;
  onNotification?: (message: string, type: 'success' | 'error') => void;
  showToast?: (message: string) => void;
}

export function useTrackedRegressionsData({
  testRunId,
  testRun,
  system,
  environment,
  workload,
  onNotification = () => { /* noop */ },
  showToast = () => { /* noop */ },
}: UseTrackedRegressionsDataOptions) {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  // State
  const [trackedRegressions, setTrackedRegressions] = useState<TrackedRegression[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [correlatedRegressions, setCorrelatedRegressions] = useState<Record<string, TrackedRegression[]>>({});
  const [chartData, setChartData] = useState<Record<string, PlotData[]>>({});
  const [selectedMetrics, setSelectedMetrics] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  // Use batch re-evaluation hook
  const { triggerBatchReevaluation } = useBatchReevaluation({
    testRun: testRun ?? null,
    testRunId,
    showToast,
  });

  // Fetch tracked regressions
  const fetchTrackedRegressions = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({ testRunId });
      if (system) queryParams.append('system', system);
      if (environment) queryParams.append('environment', environment);
      if (workload) queryParams.append('workload', workload);

      const response = await authenticatedFetch(`/adapt/tracked-regressions?${queryParams}`);
      if (response.ok) {
        const data = await response.json();
        // Sort by first detected date - oldest first for ordered resolution
        const sortedRegressions = data.regressions.sort((a: TrackedRegression, b: TrackedRegression) =>
          new Date(a.firstDetected).getTime() - new Date(b.firstDetected).getTime()
        );
        setTrackedRegressions(sortedRegressions);

        // Initialize selected metrics for each regression
        const initialMetrics: Record<string, string> = {};
        sortedRegressions.forEach((regression: TrackedRegression) => {
          initialMetrics[regression.id] = regression.metricName;
        });
        setSelectedMetrics(initialMetrics);
      }
    } catch (error) {
      // Error handling without console.log
    } finally {
      setLoading(false);
    }
  }, [testRunId, system, environment, workload]);

  // Initial fetch
  useEffect(() => {
    fetchTrackedRegressions();
  }, [fetchTrackedRegressions]);

  // Handle resolution of a regression
  const handleResolution = useCallback(async (resolution: 'accepted' | 'denied', regressionId: string) => {
    setResolving(prev => ({ ...prev, [regressionId]: true }));
    try {
      const response = await authenticatedFetch('/adapt/tracked-regressions/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regressionId,
          resolution,
          excludeFromBaseline: resolution === 'denied'
        })
      });

      if (response.ok) {
        await fetchTrackedRegressions();
        const statusMap = {
          accepted: 'accepted as normal variability',
          denied: 'marked as a real regression',
        };
        onNotification(`Regression ${statusMap[resolution]}`, 'success');

        // Trigger batch re-evaluation for more recent test runs
        await triggerBatchReevaluation();
      } else {
        const error = await response.text();
        onNotification(`Failed to resolve regression: ${error}`, 'error');
      }
    } catch {
      onNotification('Failed to resolve regression', 'error');
    } finally {
      setResolving(prev => ({ ...prev, [regressionId]: false }));
    }
  }, [fetchTrackedRegressions, onNotification, triggerBatchReevaluation]);

  // Toggle card expansion
  const toggleCardExpansion = useCallback(async (id: string) => {
    const wasExpanded = expandedCards[id];
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));

    // Fetch correlated regressions when expanding
    if (!wasExpanded && !correlatedRegressions[id]) {
      await fetchCorrelatedRegressions(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedCards, correlatedRegressions]);

  // Fetch correlated regressions for a specific regression
  const fetchCorrelatedRegressions = useCallback(async (regressionId: string) => {
    try {
      const regression = trackedRegressions.find(r => r.id === regressionId);
      if (!regression) return;

      const response = await authenticatedFetch(
        `/adapt/correlated-regressions?trackedRegressionId=${regressionId}&sourceTestRun=${regression.trackedTestRuns[0]}`
      );

      if (response.ok) {
        const data = await response.json();
        setCorrelatedRegressions(prev => ({ ...prev, [regressionId]: data.regressions }));
      }
    } catch {
      // Error handling without console.log
    }
  }, [trackedRegressions]);

  // Fetch chart data for a regression
  const fetchChartData = useCallback(async (regressionId: string, metricName: string) => {
    try {
      const response = await authenticatedFetch(
        `/adapt/tracked-regression-chart?trackedRegressionId=${regressionId}&metricName=${encodeURIComponent(metricName)}`
      );

      if (response.ok) {
        const data = await response.json();
        const processedData = processTrackedRegressionData(data, isDarkMode);
        setChartData(prev => ({ ...prev, [`${regressionId}-${metricName}`]: processedData }));
      }
    } catch {
      // Error handling without console.log
    }
  }, [isDarkMode]);

  // Handle metric selection change
  const handleMetricChange = useCallback(async (regressionId: string, metricName: string) => {
    setSelectedMetrics(prev => ({ ...prev, [regressionId]: metricName }));
    await fetchChartData(regressionId, metricName);
  }, [fetchChartData]);

  // Get chart data for a specific regression and metric
  const getChartData = useCallback((regressionId: string): PlotData[] | undefined => {
    const metricName = selectedMetrics[regressionId];
    return chartData[`${regressionId}-${metricName}`];
  }, [chartData, selectedMetrics]);

  return {
    // Data
    trackedRegressions,
    loading,
    expandedCards,
    correlatedRegressions,
    selectedMetrics,
    resolving,

    // Actions
    handleResolution,
    toggleCardExpansion,
    handleMetricChange,
    getChartData,
    refetch: fetchTrackedRegressions,
  };
}
