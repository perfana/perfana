'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, DynatraceDashboard } from '@/lib/dynatrace';
import {
  ApplicationDashboard,
  Panel,
  TimeRange,
  MetricStatistic,
  TrendsSeries,
  DataSource,
  TIME_RANGE_OPTIONS,
} from '../types';
import { TestRun } from '@/types/test-runs';
import { isGrafana, isPerformanceTest } from '@/lib/metrics-source-utils';
import {
  ALL_AGGREGATED_OPTION,
  isAllAggregatedDashboard,
  getAggregateSpec,
  buildAggregatedMetricName,
  fetchAggregatedStatistics,
} from '@/lib/aggregated-perf-series';
import { buildAggregatedTrendsStatistics } from '../utils/trends-utils';
import type { SeriesPick } from '../../shared/metric-options';

interface UseTrendsDataProps {
  testRun: TestRun | null;
  testRunId: string;
  trendsExpanded: boolean;
}

export function useTrendsData({ testRun, testRunId, trendsExpanded }: UseTrendsDataProps) {
  // Source and selection state. selectedDashboard/selectedMetric are the FIRST dashboard
  // and panel picked in the cascade — a preset stores one of each and names itself after
  // them; the cascade holds the actual multi-selection.
  const [selectedSource, setSelectedSource] = useState<DataSource>('grafana');
  const [availableSources, setAvailableSources] = useState<DataSource[]>([]);
  const [selectedDashboard, setSelectedDashboard] = useState<ApplicationDashboard | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<Panel | null>(null);

  // Time range state
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGE_OPTIONS[number]>(TIME_RANGE_OPTIONS[3]); // Default to "Last week"
  const [customTimeRange, setCustomTimeRange] = useState<TimeRange>({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date()
  });
  const [evaluateType, setEvaluateType] = useState<string>('avg');

  // Grafana data state
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);

  // Dynatrace data state
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);

  // Series and chart data state
  const [addedSeries, setAddedSeries] = useState<TrendsSeries[]>([]);
  const [metricsData, setMetricsData] = useState<MetricStatistic[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<Set<string>>(new Set());

  // Oldest test run date state
  const [oldestTestRunDate, setOldestTestRunDate] = useState<string | null>(null);
  const [oldestTestRunLoading, setOldestTestRunLoading] = useState(false);

  // Load oldest test run date from related test runs
  const fetchOldestTestRunDate = useCallback(async () => {
    if (!testRun) return;

    try {
      setOldestTestRunLoading(true);

      const system = testRun.systems_under_test?.name;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      let url = `/test-runs/${testRunId}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({ system, environment, workload });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const relatedTestRuns = await response.json();
        if (relatedTestRuns.length > 0) {
          const allTestRuns = [testRun, ...relatedTestRuns];
          const oldestTestRun = allTestRuns.reduce((oldest, current) => {
            return new Date(current.created_at) < new Date(oldest.created_at) ? current : oldest;
          });
          setOldestTestRunDate(oldestTestRun.created_at);
        } else {
          setOldestTestRunDate(testRun.created_at);
        }
      } else {
        console.warn('Failed to fetch related test runs:', response.statusText);
        setOldestTestRunDate(testRun.created_at);
      }
    } catch (error) {
      console.error('Error fetching related test runs:', error);
      setOldestTestRunDate(testRun.created_at);
    } finally {
      setOldestTestRunLoading(false);
    }
  }, [testRun, testRunId]);

  // Load Grafana dashboards
  const fetchApplicationDashboards = useCallback(async (): Promise<ApplicationDashboard[]> => {
    if (!testRun) return [];

    try {
      setDashboardsLoading(true);
      // hasData: a dashboard no run ever recorded metrics for has no panels to pick — same
      // filter the compare card and the report pickers use. Run-agnostic, so it is still
      // right for a trend spanning many runs.
      const url = `/grafana/application-dashboards?systemId=${encodeURIComponent(testRun.system_under_test_id || '')}&environment=${encodeURIComponent(testRun.test_environment)}&hasData=true`;

      const response = await authenticatedFetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const dashboardsData = await response.json();
        setDashboards(dashboardsData);
        return dashboardsData;
      } else {
        console.warn('Failed to fetch application dashboards:', response.statusText);
        setDashboards([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching application dashboards:', error);
      setDashboards([]);
      return [];
    } finally {
      setDashboardsLoading(false);
    }
  }, [testRun]);

  // Load Dynatrace dashboards
  const fetchDynatraceDashboardsList = useCallback(async () => {
    if (!testRun) return;

    try {
      setDynatraceDashboardsLoading(true);
      const systemId = testRun.system_under_test_id;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      if (!systemId || !environment || !workload) {
        setDynatraceDashboards([]);
        return;
      }

      const dashboardsData = await fetchDynatraceDashboards(systemId, environment, workload);
      setDynatraceDashboards(dashboardsData);
    } catch (error) {
      console.error('Error fetching Dynatrace dashboards:', error);
      setDynatraceDashboards([]);
    } finally {
      setDynatraceDashboardsLoading(false);
    }
  }, [testRun]);

  // Load metrics data for all added series
  const fetchMetricsData = useCallback(async () => {
    if (addedSeries.length === 0) {
      setMetricsData([]);
      return;
    }

    try {
      setMetricsLoading(true);

      // Calculate time range
      let fromDate: Date;
      let toDate: Date;

      if (timeRange.value === 'custom') {
        fromDate = customTimeRange.from;
        toDate = customTimeRange.to;
      } else {
        toDate = new Date();

        if (timeRange.type === 'months') {
          fromDate = new Date(toDate);
          fromDate.setMonth(fromDate.getMonth() - (timeRange.value as number));
        } else {
          const days = timeRange.value as number;
          fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        }
      }

      const aggregatedSeries = addedSeries.filter(s => s.isAggregated);
      const normalSeries = addedSeries.filter(s => !s.isAggregated);

      // Group series by dashboard/panel to minimize API calls
      const seriesByDashboardPanel = normalSeries.reduce((acc, series) => {
        const key = `${series.dashboardId}-${series.panelId}`;
        if (!acc[key]) {
          acc[key] = {
            dashboardId: series.dashboardId,
            panelId: series.panelId,
            metricsSourceId: series.metricsSourceId,
            seriesByMetricName: new Map<string, TrendsSeries>()
          };
        }
        acc[key].seriesByMetricName.set(series.metricName, series);
        return acc;
      }, {} as Record<string, { dashboardId: string; panelId: number; metricsSourceId?: string; seriesByMetricName: Map<string, TrendsSeries> }>);

      // Fetch data for each dashboard/panel combination
      const allData: MetricStatistic[] = [];

      for (const { dashboardId, panelId, metricsSourceId, seriesByMetricName } of Object.values(seriesByDashboardPanel)) {
        if (panelId == null || dashboardId == null) {
          console.warn('Skipping series group with missing dashboardId or panelId:', { dashboardId, panelId });
          continue;
        }
        const queryParams = new URLSearchParams({
          applicationDashboardId: dashboardId,
          panelId: panelId.toString(),
          evaluateType,
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        });

        // Send metricsSourceId if available
        if (metricsSourceId) {
          queryParams.set('metricsSourceId', metricsSourceId);
        }

        if (testRun?.systems_under_test?.name) {
          queryParams.set('system', testRun.systems_under_test.name);
        }
        if (testRun?.test_environment) {
          queryParams.set('environment', testRun.test_environment);
        }
        if (testRun?.workload) {
          queryParams.set('workload', testRun.workload);
        }

        const response = await authenticatedFetch(
          `/metrics/ds-metric-statistics?${queryParams.toString()}`,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (response.ok) {
          const data: MetricStatistic[] = await response.json();
          for (const item of data) {
            const series = seriesByMetricName.get(item.metric_name);
            if (series) allData.push({ ...item, series_id: series.id });
          }
        } else {
          console.warn('Failed to fetch metrics data for panel:', panelId, response.statusText);
        }
      }

      // Aggregated series: one batch call each across all related runs in range.
      if (aggregatedSeries.length > 0 && testRun) {
        const relatedUrl = (() => {
          const p = new URLSearchParams();
          if (testRun.systems_under_test?.name) p.set('system', testRun.systems_under_test.name);
          if (testRun.test_environment) p.set('environment', testRun.test_environment);
          if (testRun.workload) p.set('workload', testRun.workload);
          const qs = p.toString();
          return `/test-runs/${testRunId}/related${qs ? `?${qs}` : ''}`;
        })();
        const relatedRes = await authenticatedFetch(relatedUrl, { headers: { 'Content-Type': 'application/json' } });
        const related: Array<{ test_run_id: string; created_at: string; version?: string | null }> =
          relatedRes.ok ? await relatedRes.json() : [];
        const runs = [
          { test_run_id: testRun.test_run_id, created_at: testRun.created_at, version: (testRun as { version?: string | null }).version ?? null },
          ...related,
        ];
        // De-dupe (the anchor run may also appear in related) and clip to time range.
        const seen = new Set<string>();
        const runsInRange = runs.filter(r => {
          if (seen.has(r.test_run_id)) return false;
          seen.add(r.test_run_id);
          const t = new Date(r.created_at).getTime();
          return t >= fromDate.getTime() && t <= toDate.getTime();
        });
        const ids = runsInRange.map(r => r.test_run_id);

        // Same shape as useCompareData: one request per DISTINCT metric, fetched in
        // parallel. `stat` no longer changes the SQL — every statistic comes off the
        // merged sketch — so two series sharing a metric were issuing byte-identical
        // requests, one after the other.
        if (ids.length > 0) {
          const specced = aggregatedSeries
            .map(series => ({ series, spec: getAggregateSpec(series.panelId) }))
            .filter((e): e is { series: typeof e.series; spec: NonNullable<typeof e.spec> } =>
              e.spec !== null,
            );

          const specByMetric = new Map(specced.map(e => [e.spec.metric, e.spec]));
          const fetched = await Promise.all(
            [...specByMetric.values()].map(async spec => {
              const values = await fetchAggregatedStatistics(testRun.test_run_id, ids, spec);
              return [spec.metric, values] as const;
            }),
          );
          const valuesByMetric = new Map(fetched);

          for (const { series, spec } of specced) {
            const values = valuesByMetric.get(spec.metric);
            if (!values) continue;
            allData.push(...buildAggregatedTrendsStatistics(series, values, runsInRange));
          }
        }
      }

      setMetricsData(allData);
      setSelectedSeriesIds(new Set(addedSeries.map(s => s.id)));

    } catch (error) {
      console.error('Error fetching metrics data:', error);
      setMetricsData([]);
      setSelectedSeriesIds(new Set());
    } finally {
      setMetricsLoading(false);
    }
  }, [addedSeries, evaluateType, timeRange, customTimeRange, testRun, testRunId]);

  // Compute available sources based on loaded dashboards
  useEffect(() => {
    const sources: DataSource[] = [];

    // Check for real Grafana dashboards (not artificial)
    const grafanaDashboards = dashboards.filter(d => isGrafana(d));
    if (grafanaDashboards.length > 0) {
      sources.push('grafana');
    }

    // Check for Dynatrace dashboards
    if (dynatraceDashboards.length > 0) {
      sources.push('dynatrace');
    }

    // Check for performance-test-metrics dashboards
    const perfMetricsDashboards = dashboards.filter(d => isPerformanceTest(d));
    if (perfMetricsDashboards.length > 0) {
      sources.push('performance-metrics');
    }

    setAvailableSources(sources);

    // Auto-select first available source if current selection is not available
    if (sources.length > 0 && !sources.includes(selectedSource)) {
      setSelectedSource(sources[0]);
    }
  }, [dashboards, dynatraceDashboards, selectedSource]);

  // Load dashboards when expanded and no data is available
  useEffect(() => {
    if (trendsExpanded && testRun) {
      if (dashboards.length === 0) {
        fetchApplicationDashboards();
      }
      if (dynatraceDashboards.length === 0) {
        fetchDynatraceDashboardsList();
      }
    }
  }, [trendsExpanded, testRun, dashboards.length, dynatraceDashboards.length, fetchApplicationDashboards, fetchDynatraceDashboardsList]);

  // Fetch metrics data when addedSeries, evaluateType, or timeRange changes
  useEffect(() => {
    if (addedSeries.length > 0) {
      fetchMetricsData();
    }
  }, [addedSeries, evaluateType, timeRange, customTimeRange, fetchMetricsData]);

  // Load oldest test run date when component mounts
  useEffect(() => {
    if (testRun && !oldestTestRunDate && !oldestTestRunLoading) {
      fetchOldestTestRunDate();
    }
  }, [testRun, oldestTestRunDate, oldestTestRunLoading, fetchOldestTestRunDate]);

  // Get all dashboards merged for the grouped dropdown
  const getAllDashboardsMerged = useCallback((): ApplicationDashboard[] => {
    const grafanaOnly = dashboards.filter(d => isGrafana(d));
    const perfTestOnly = dashboards.filter(d => isPerformanceTest(d));
    const dynatraceAsDashboards: ApplicationDashboard[] = dynatraceDashboards.map((d, index) => ({
      id: `dynatrace-${index}`,
      dashboard_label: d.dashboardLabel,
      dashboard_name: d.dashboardLabel,
      dashboard_uid: `dynatrace-${d.dashboardLabel}`,
      source_type: 'dynatrace',
    } as ApplicationDashboard));
    return [...grafanaOnly, ...perfTestOnly, ...dynatraceAsDashboards];
  }, [dashboards, dynatraceDashboards]);

  // The cascade's first pick, kept as preset-save context and the chart title.
  const handlePrimaryChange = useCallback((dashboard: ApplicationDashboard | null, panel: Panel | null) => {
    setSelectedDashboard(dashboard);
    setSelectedMetric(panel);
  }, []);

  // Add the picked series. Each pick carries its own dashboard and panel, so one click can
  // add series from several panels across several dashboards.
  const handleAddSeries = useCallback((picks: SeriesPick[]) => {
    const newSeries: TrendsSeries[] = picks.map(({ dashboard, panel, metricName }) => {
      const isAggregated = metricName === ALL_AGGREGATED_OPTION
        && !isAllAggregatedDashboard(dashboard.dashboard_label);
      return {
        id: `${dashboard.id}-${panel.id}-${metricName}-${Date.now()}-${Math.random()}`,
        dashboardId: panel.applicationDashboardId || dashboard.id,
        dashboardLabel: dashboard.dashboard_label,
        panelId: panel.id,
        panelTitle: panel.title,
        metricName: isAggregated ? buildAggregatedMetricName(panel.title) : metricName,
        source: panel.source,
        yAxisFormat: panel.yAxesFormat,
        metricsSourceId: panel.metricsSourceId || dashboard.metrics_source_id,
        isAggregated,
      };
    });

    const filteredNewSeries = newSeries.filter(newS =>
      !addedSeries.some(
        existing =>
          existing.dashboardId === newS.dashboardId &&
          existing.panelId === newS.panelId &&
          existing.metricName === newS.metricName
      )
    );

    if (filteredNewSeries.length > 0) {
      setSelectedSource(filteredNewSeries[0]!.source);
      // Preset saving needs one dashboard/panel; the cascade may have been cleared since.
      setSelectedDashboard(prev => prev ?? picks[0]!.dashboard);
      setSelectedMetric(prev => prev ?? picks[0]!.panel);
      setAddedSeries(prev => [...prev, ...filteredNewSeries]);
    }
    return filteredNewSeries.length;
  }, [addedSeries]);

  // Handle removing a series
  const handleRemoveSeries = useCallback((seriesId: string) => {
    setAddedSeries(prev => prev.filter(s => s.id !== seriesId));
  }, []);

  // Handle clearing all series
  const handleClearAllSeries = useCallback(() => {
    setAddedSeries([]);
    setMetricsData([]);
  }, []);

  // Handle updating series unit
  const handleUpdateSeriesUnit = useCallback((seriesId: string, newUnit: string | null) => {
    setAddedSeries(prev => prev.map(series =>
      series.id === seriesId
        ? { ...series, yAxisFormat: newUnit || undefined }
        : series
    ));
  }, []);

  // Handle time range change
  const handleTimeRangeChange = useCallback((newRange: typeof TIME_RANGE_OPTIONS[number]) => {
    setTimeRange(newRange);
  }, []);

  // Handle custom time range change
  const handleCustomTimeRangeChange = useCallback((field: 'from' | 'to', date: Date | null) => {
    if (!date) return;
    setCustomTimeRange(prev => ({ ...prev, [field]: date }));
  }, []);

  // Handle evaluate type change
  const handleEvaluateTypeChange = useCallback((newType: string) => {
    setEvaluateType(newType);
  }, []);

  return {
    // State
    selectedSource,
    availableSources,
    selectedDashboard,
    selectedMetric,
    timeRange,
    customTimeRange,
    evaluateType,
    dashboards,
    dashboardsLoading,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    addedSeries,
    metricsData,
    metricsLoading,
    selectedSeriesIds,
    oldestTestRunDate,
    oldestTestRunLoading,

    // State setters (for preset application)
    setSelectedSource,
    setSelectedDashboard,
    setSelectedMetric,
    setEvaluateType,
    setAddedSeries,

    // Fetch functions
    fetchApplicationDashboards,
    fetchDynatraceDashboardsList,
    fetchMetricsData,

    // Handlers
    getAllDashboardsMerged,
    handlePrimaryChange,
    handleAddSeries,
    handleRemoveSeries,
    handleClearAllSeries,
    handleUpdateSeriesUnit,
    handleTimeRangeChange,
    handleCustomTimeRangeChange,
    handleEvaluateTypeChange,
  };
}
