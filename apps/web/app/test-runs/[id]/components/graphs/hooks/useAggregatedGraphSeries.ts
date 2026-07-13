'use client';

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { DataSource, SeriesConfig, MetricDataPoint } from '../types';
import {
  AGGREGATED_METRIC_SPECS,
  buildAggregatedMetricSeries,
  AggregatedBucket,
} from '../utils/aggregated-series';

interface UseAggregatedGraphSeriesProps {
  testRun: TestRun | null;
  testRunId: string;
  selectedSource: DataSource;
}

/**
 * Fetches the run-wide aggregate (all transactions collapsed) for the three
 * report-parity metrics and exposes them as overlay series for the Graphs
 * chart. Only active for the performance-metrics source; clears otherwise.
 */
export function useAggregatedGraphSeries({
  testRun,
  testRunId,
  selectedSource,
}: UseAggregatedGraphSeriesProps) {
  const [includeAggregated, setIncludeAggregated] = useState(false);
  const [aggregatedSeries, setAggregatedSeries] = useState<SeriesConfig[]>([]);
  const [aggregatedData, setAggregatedData] = useState<Map<string, MetricDataPoint[]>>(new Map());
  const [aggregatedLoading, setAggregatedLoading] = useState(false);

  const isPerfSource = selectedSource === 'performance-metrics';

  useEffect(() => {
    // Off, or wrong source → nothing to overlay.
    if (!includeAggregated || !isPerfSource) {
      setAggregatedSeries([]);
      setAggregatedData(new Map());
      return;
    }

    let cancelled = false;
    const run = async () => {
      setAggregatedLoading(true);
      const testRunIdForQuery = testRun?.test_run_id || testRunId;
      const configs: SeriesConfig[] = [];
      const dataMap = new Map<string, MetricDataPoint[]>();

      await Promise.all(
        AGGREGATED_METRIC_SPECS.map(async (spec) => {
          try {
            const res = await authenticatedFetch(
              `/test-runs/${testRunIdForQuery}/aggregated-metric-timeseries?metric=${spec.metric}&stat=avg`,
              { headers: { 'Content-Type': 'application/json' } },
            );
            if (!res.ok) return;
            const body: { buckets?: AggregatedBucket[] } = await res.json();
            const buckets = body.buckets ?? [];
            if (buckets.length === 0) return;
            const { config, data } = buildAggregatedMetricSeries(spec, buckets);
            configs.push(config);
            dataMap.set(config.id, data);
          } catch (err) {
            console.error(`Failed to fetch aggregated ${spec.metric}:`, err);
          }
        }),
      );

      if (!cancelled) {
        setAggregatedSeries(configs);
        setAggregatedData(dataMap);
        setAggregatedLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [includeAggregated, isPerfSource, testRun, testRunId]);

  return {
    includeAggregated,
    setIncludeAggregated,
    aggregatedSeries,
    aggregatedData,
    aggregatedLoading,
    showAggregatedToggle: isPerfSource,
  };
}
