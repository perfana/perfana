import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataAggregator } from '../../../../pipelines/checks/DataAggregator.js';
import { DataAggregationError } from '../../../../pipelines/checks/BaseCheckService.js';
import type { EntityManager } from 'typeorm';
import type { TestRun, Benchmark } from '../../../../pipelines/checks/BenchmarkMatcher.js';
import { RUN_SERIES_GROUP_MEMBERS_SQL, SLO_STATISTIC_COLUMNS } from '../../../../pipelines/helpers/statistics-sql.js';
import { SERIES_GROUPING_TABLES_PROBE_SQL } from '../../../../pipelines/helpers/series-grouping-plan.js';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

describe('DataAggregator', () => {
  let aggregator: DataAggregator;
  let mockManager: any;
  // The run's grouping membership is answered here, outside mockManager.query, so every test's
  // call indices stay those of the statistics/rollup reads it asserts on.
  let groupMembers: Array<{ application_dashboard_id: string; panel_id: number; metric_name: string }>;
  let membershipCalls: unknown[][];
  let groupingTablesPresent: boolean;
  let membershipFailures: number;
  let budgetCalls: unknown[][];
  const groupPanel = (names: string[], dashboard = 'app-dash-1', panel = 1) =>
    names.map((metric_name) => ({ application_dashboard_id: dashboard, panel_id: panel, metric_name }));

  const createMockTestRun = (overrides?: Partial<TestRun>): TestRun => ({
    test_run_id: 'test-run-1',
    system_under_test_id: 'sut-1',
    test_environment: 'production',
    workload: 'load-test',
    start_time: new Date('2024-01-01T12:00:00Z'),
    end_time: new Date('2024-01-01T13:00:00Z'),
    ramp_up: 60,
    ...overrides,
  });

  const createMockBenchmark = (overrides?: Partial<Benchmark>): Benchmark => ({
    id: 'benchmark-1',
    system_under_test_id: 'sut-1',
    test_environment: 'production',
    workload: 'load-test',
    dashboard_uid: 'dash-1',
    dashboard_label: 'metrics',
    application_dashboard_id: 'app-dash-1',
    configuration: { id: 1 },
    requirement_operator: 'gte',
    requirement_value: 100,
    validate_with_default_if_no_data: false,
    validate_with_default_if_no_data_value: null,
    average_all: false,
    exclude_ramp_up_time: true,
    panel_title: 'CPU Usage',
    evaluate_type: 'mean',
    metric_unit: 'percent',
    valid: true,
    enabled: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock EntityManager
    mockManager = {
      query: vi.fn(),
    };
    groupMembers = [];
    membershipCalls = [];
    groupingTablesPresent = true;
    membershipFailures = 0;
    budgetCalls = [];
    const manager = {
      query: (sql: string, params?: unknown[]) => {
        if (sql === SERIES_GROUPING_TABLES_PROBE_SQL) return Promise.resolve([{ present: groupingTablesPresent }]);
        if (sql === 'SELECT set_config($1, $2, true)') { budgetCalls.push(params ?? []); return Promise.resolve([]); }
        if (sql !== RUN_SERIES_GROUP_MEMBERS_SQL) return mockManager.query(sql, params);
        membershipCalls.push(params ?? []);
        if (membershipFailures > 0) { membershipFailures--; return Promise.reject(new Error('transient')); }
        return Promise.resolve(groupMembers);
      },
    };

    aggregator = new DataAggregator(mockLogger as any, manager as unknown as EntityManager);
  });

  describe('aggregateMetricsForBenchmark', () => {
    const podRow = (metric_name: string, mean: number, dashboard = 'app-dash-1', panel = 1) =>
      ({ application_dashboard_id: dashboard, panel_id: panel, metric_name, mean, is_constant: false, count: 50 });

    it('judges the raw series of a grouped panel, never its group rows', async () => {
      groupMembers = groupPanel(['pod: emc-a', 'pod: emc-b']);
      mockManager.query.mockResolvedValueOnce([podRow('pod: emc-a', 0.2), podRow('pod: emc-b', 0.15)]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());

      const [sql] = mockManager.query.mock.calls[0];
      expect(sql).toContain('FROM ds_metrics m');
      expect(sql).not.toContain('FROM ds_metric_statistics');
      expect(result.targets.map((t) => t.target)).toEqual(['pod: emc-a', 'pod: emc-b']);
    });

    // protects=  the raw-series read is ONE run-scoped, time-bounded, tenant-scoped read over the
    //            run's grouped panels, bound with exactly 5 params, and never writes
    // fails_when= the time bound is dropped (every chunk locked, CLAUDE.md #56), the panel pairing or
    //            allowed_dashboards scope is lost, a $6 appears, or the read reuses the INSERT path
    // why_new=   check:grouped-sql PREPAREs without param types, so a stray placeholder still
    //            prepares; nothing else asserts the bound or the pairing
    // seam=none  no_claim= that the SQL resolves against the schema (check:grouped-sql does that)
    it('reads the run once, bounded by the padded run window and scoped to its grouped panels', async () => {
      groupMembers = [...groupPanel(['pod: emc-a']), ...groupPanel(['pod: emc-a name: global'], 'app-dash-1', 132)];
      mockManager.query.mockResolvedValueOnce([podRow('pod: emc-a', 0.2)]);

      await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun({ organization_id: 'org-1' } as Partial<TestRun>), createMockBenchmark());

      expect(membershipCalls).toEqual([['test-run-1']]);
      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('m.time >= $2');
      expect(sql).toContain('m.time <= $3');
      expect(sql).toContain('unnest($4::uuid[], $5::int[])');
      // Tenant scope: the run's org decides which dashboards count, as on the ungrouped path.
      expect(sql).toContain('m.application_dashboard_id IN (SELECT id FROM allowed_dashboards)');
      expect(sql).not.toMatch(/\$6\b/);
      expect(sql).not.toMatch(/\b(INSERT|DELETE|UPDATE)\b/i);
      expect(params).toEqual([
        'test-run-1',
        new Date('2023-12-31T12:00:00Z'),
        new Date('2024-01-02T13:00:00Z'),
        ['app-dash-1', 'app-dash-1'],
        [1, 132],
      ]);
    });

    // protects=  every SLO on a run's grouped panels shares one ds_metrics read (the whole run's
    //            segment is decompressed by any read, compress_segmentby = test_run_id)
    // fails_when= the cache is dropped and each grouped-panel SLO re-reads the run (N+1 full scans)
    // why_new=   no other test runs two benchmarks through one aggregator
    // seam=none  no_claim= the real cost of the read (no database here)
    it('shares one raw-series read across the SLOs on a run\'s grouped panels', async () => {
      groupMembers = [...groupPanel(['pod: emc-a']), ...groupPanel(['pod: emc-a name: global'], 'app-dash-1', 132)];
      mockManager.query.mockResolvedValueOnce([
        podRow('pod: emc-a', 0.2),
        podRow('pod: emc-a name: global', 0.03, 'app-dash-1', 132),
      ]);
      const testRun = createMockTestRun();

      const cpu = await aggregator.aggregateMetricsForBenchmark(testRun, createMockBenchmark());
      const gc = await aggregator.aggregateMetricsForBenchmark(
        testRun, createMockBenchmark({ id: 'benchmark-2', configuration: { id: 132 } }));

      expect(mockManager.query).toHaveBeenCalledTimes(1);
      expect(membershipCalls).toHaveLength(1);
      expect(cpu.targets.map((t) => t.target)).toEqual(['pod: emc-a']);
      expect(gc.targets.map((t) => t.target)).toEqual(['pod: emc-a name: global']);
    });

    it('applies a raw-series metric filter to the raw rows', async () => {
      groupMembers = groupPanel(['pod: emc-a', 'pod: emc-b']);
      mockManager.query.mockResolvedValueOnce([podRow('pod: emc-a', 0.2), podRow('pod: emc-b', 0.15)]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(), createMockBenchmark(), 'pod: emc-b');

      expect(mockManager.query.mock.calls[0][0]).toContain('FROM ds_metrics m');
      expect(result.targets.map((t) => t.target)).toEqual(['pod: emc-b']);
    });

    // protects=  an SLO whose metric filter names a GROUP series (offered by the pickers) keeps
    //            judging that stored group row
    // fails_when= a group-name filter is sent to the raw read, finds nothing, and the SLO silently
    //            reads as no data / the artificial default
    // why_new=   the other grouped tests filter by a raw name or not at all
    // seam=none  no_claim= none beyond protects
    it('keeps reading the stored group row when the metric filter names a group series', async () => {
      groupMembers = groupPanel(['pod: emc-a', 'pod: emc-b']);
      mockManager.query.mockResolvedValueOnce([{ metric_name: 'pod: emc (avg)', mean: 0.18, is_constant: false, count: 50 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(), createMockBenchmark(), 'pod: emc (avg)');

      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('FROM ds_metric_statistics');
      expect(params).toEqual(['test-run-1', 'app-dash-1', 1, 'pod: emc (avg)']);
      expect(result.targets.map((t) => t.target)).toEqual(['pod: emc (avg)']);
    });

    // protects=  a grouped panel with no raw points in the window takes the same no-data branch as
    //            an ungrouped one (null result, or the artificial default when configured)
    // fails_when= a grouped panel absent from the raw rows throws, or falls back to the group rows
    // why_new=   every existing no-data test runs on an ungrouped panel
    // seam=none  no_claim= what ADAPT does with the artificial row (unchanged by this branch)
    it('treats a grouped panel with no raw points as no data', async () => {
      groupMembers = groupPanel(['pod: emc-a']);
      mockManager.query.mockResolvedValueOnce([podRow('pod: emc-z', 1, 'app-dash-1', 999)]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());

      expect(mockManager.query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ panel_average: null, targets: [] });
    });

    // protects=  an SLO on an ungrouped panel does not depend on series grouping: a database before
    //            migration 1819 (no ds_metric_series_groups) and a transient membership failure
    //            both leave the ds_metric_statistics path working for later benchmarks
    // fails_when= the to_regclass probe is dropped (42P01 on every SLO) or a rejected membership
    //            read stays cached and fails every later SLO of the run
    // why_new=   no other test drives the grouping read's failure or absence
    // seam=none  no_claim= real savepoint behaviour (ChecksPipeline owns it; no database here)
    it('never reads the membership table when it does not exist', async () => {
      groupingTablesPresent = false;
      mockManager.query.mockResolvedValueOnce([{ metric_name: 'cpu', mean: 1, is_constant: false, count: 50 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());

      expect(membershipCalls).toHaveLength(0);
      expect(mockManager.query.mock.calls[0][0]).toContain('FROM ds_metric_statistics');
      expect(result.targets.map((t) => t.target)).toEqual(['cpu']);
    });

    it('retries the membership read after a transient failure instead of replaying it', async () => {
      membershipFailures = 1;
      const testRun = createMockTestRun();
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, createMockBenchmark())).rejects.toThrow();

      mockManager.query.mockResolvedValueOnce([{ metric_name: 'cpu', mean: 1, is_constant: false, count: 50 }]);
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, createMockBenchmark());

      expect(membershipCalls).toHaveLength(2);
      expect(result.targets.map((t) => t.target)).toEqual(['cpu']);
    });

    // protects=  a failed raw-series read (the whole run's segment) is not re-issued for every
    //            grouped-panel SLO of the run
    // fails_when= the rejection is evicted and each SLO re-runs the read, N x statement_timeout
    // why_new=   the retry test above covers the cheap membership read only
    // seam=none  no_claim= real timeout behaviour (no database here)
    it('does not re-issue a failed raw-series read for the next grouped-panel SLO', async () => {
      groupMembers = [...groupPanel(['pod: emc-a']), ...groupPanel(['pod: emc-a name: global'], 'app-dash-1', 132)];
      mockManager.query.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));
      const testRun = createMockTestRun();

      await expect(aggregator.aggregateMetricsForBenchmark(testRun, createMockBenchmark())).rejects.toThrow();
      await expect(aggregator.aggregateMetricsForBenchmark(
        testRun, createMockBenchmark({ id: 'benchmark-2', configuration: { id: 132 } }))).rejects.toThrow();

      expect(mockManager.query).toHaveBeenCalledTimes(1);
    });

    // protects=  the whole-run raw read runs under the aggregation budget (statement_timeout below
    //            the client's 600 s query_timeout, work_mem for the sketches), set before the read
    // fails_when= the budget is dropped, so a slow read hits the client timeout, the socket is torn
    //            down and every later SLO of the run fails on a dead connection
    // why_new=   nothing else asserts the checks transaction's timeout around this read
    // seam=none  no_claim= that Postgres honours set_config (StatisticsPipeline relies on the same)
    it('sets the aggregation budget before the raw-series read', async () => {
      groupMembers = groupPanel(['pod: emc-a']);
      mockManager.query.mockResolvedValueOnce([podRow('pod: emc-a', 0.2)]);

      await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());

      expect(budgetCalls.map(([name]) => name)).toEqual(['statement_timeout', 'work_mem']);
      expect(Number(budgetCalls[0][1])).toBeLessThan(600000);
    });

    // protects=  a one-pod grouped panel whose value never moved keeps its pod name as the target
    // fails_when= the single-constant-series shortcut relabels it `default` / artificial
    // why_new=   the shortcut was only reachable from ds_metric_statistics rows before
    // seam=none  no_claim= none beyond protects
    it('keeps the pod name of a constant single-pod grouped series', async () => {
      groupMembers = groupPanel(['pod: emc-a']);
      mockManager.query.mockResolvedValueOnce([{ ...podRow('pod: emc-a', 0), is_constant: true }]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());

      expect(result.targets).toEqual([{ target: 'pod: emc-a', value: 0, isArtificial: true }]);
    });

    // protects=  the no-data default on a grouped panel is returned but never written into
    //            ds_metric_statistics, where ADAPT would compare it beside the group rows
    // fails_when= createArtificialMetricStatistic runs on the raw path (an INSERT after the read)
    // why_new=   every artificial-default test runs on an ungrouped panel
    // seam=none  no_claim= none beyond protects
    it('returns the no-data default on a grouped panel without writing it to ADAPT\'s table', async () => {
      groupMembers = groupPanel(['pod: emc-a']);
      mockManager.query.mockResolvedValueOnce([]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        createMockBenchmark({ validate_with_default_if_no_data: true, validate_with_default_if_no_data_value: 5 }));

      expect(mockManager.query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ panel_average: 5, targets: [{ target: 'default', value: 5, isArtificial: true }] });
    });

    it('selects the same statistics columns on both reads', async () => {
      mockManager.query.mockResolvedValueOnce([]);
      await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());
      expect(mockManager.query.mock.calls[0][0]).toContain(SLO_STATISTIC_COLUMNS);

      groupMembers = groupPanel(['pod: emc-a']);
      const grouped = new DataAggregator(mockLogger as any, {
        query: (sql: string, params?: unknown[]) =>
          sql === SERIES_GROUPING_TABLES_PROBE_SQL ? Promise.resolve([{ present: true }])
            : sql === 'SELECT set_config($1, $2, true)' ? Promise.resolve([])
            : sql === RUN_SERIES_GROUP_MEMBERS_SQL ? Promise.resolve(groupMembers) : mockManager.query(sql, params),
      } as unknown as EntityManager);
      mockManager.query.mockResolvedValueOnce([]);
      await grouped.aggregateMetricsForBenchmark(createMockTestRun(), createMockBenchmark());
      expect(mockManager.query.mock.calls[1][0]).toContain(SLO_STATISTIC_COLUMNS);
    });

    it('should aggregate metrics using mean evaluation type', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ evaluate_type: 'mean' });

      const mockMetricStats = [
        {
          metric_name: 'cpu_usage',
          mean: 75.5,
          median: 74.0,
          min_value: 50.0,
          max_value: 95.0,
          std_dev: 10.2,
          q10: 60.0,
          q25: 68.0,
          q75: 82.0,
          q90: 88.0,
          q95: 91.0,
          q99: 94.0,
          last_value: 76.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(75.5);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({
        target: 'cpu_usage',
        value: 75.5,
        isArtificial: false,
      });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM ds_metric_statistics'),
        ['test-run-1', 'app-dash-1', 1]
      );
    });

    it('should aggregate metrics using p95 evaluation type', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ evaluate_type: 'q95' });

      const mockMetricStats = [
        {
          metric_name: 'response_time',
          mean: 250.0,
          median: 240.0,
          min_value: 100.0,
          max_value: 500.0,
          std_dev: 50.0,
          q10: 180.0,
          q25: 210.0,
          q75: 280.0,
          q90: 320.0,
          q95: 400.0,
          q99: 480.0,
          last_value: 260.0,
          count: 200,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(400.0);
      expect(result.targets[0].value).toBe(400.0);
    });

    it.each([
      ['q50', 240.0],
      ['median', 240.0],
      ['Q50', 240.0],
    ])('reads the median for evaluate type %s (the SLO dialogs store the median as q50)', async (evaluateType, expected) => {
      // Regression: 'q50' had no mapping entry, so a median SLO was silently judged on the mean.
      const benchmark = createMockBenchmark({ evaluate_type: evaluateType });
      mockManager.query.mockResolvedValue([
        {
          metric_name: 'response_time',
          mean: 250.0,
          median: 240.0,
          min_value: 100.0,
          max_value: 500.0,
          std_dev: 50.0,
          q10: 180.0,
          q25: 210.0,
          q75: 280.0,
          q90: 320.0,
          q95: 400.0,
          q99: 480.0,
          last_value: 260.0,
          count: 200,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), benchmark);

      expect(result.targets[0].value).toBe(expected);
      expect(result.panel_average).toBe(expected);
      expect(result.targets[0].value).not.toBe(250.0);
    });

    it('should average all metrics when average_all is true', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ average_all: true });

      const mockMetricStats = [
        {
          metric_name: 'cpu_usage_host1',
          mean: 70.0,
          median: 70.0,
          min_value: 50.0,
          max_value: 90.0,
          std_dev: 10.0,
          q10: 60.0,
          q25: 65.0,
          q75: 75.0,
          q90: 80.0,
          q95: 85.0,
          q99: 88.0,
          last_value: 71.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
        {
          metric_name: 'cpu_usage_host2',
          mean: 80.0,
          median: 80.0,
          min_value: 60.0,
          max_value: 95.0,
          std_dev: 8.0,
          q10: 70.0,
          q25: 75.0,
          q75: 85.0,
          q90: 88.0,
          q95: 90.0,
          q99: 93.0,
          last_value: 82.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(75.0); // Average of 70 and 80
      expect(result.targets).toHaveLength(2);
    });

    it('should use first value when average_all is false', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ average_all: false });

      const mockMetricStats = [
        {
          metric_name: 'metric1',
          mean: 100.0,
          median: 100.0,
          min_value: 80.0,
          max_value: 120.0,
          std_dev: 10.0,
          q10: 85.0,
          q25: 90.0,
          q75: 110.0,
          q90: 115.0,
          q95: 118.0,
          q99: 119.0,
          last_value: 101.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
        {
          metric_name: 'metric2',
          mean: 200.0,
          median: 200.0,
          min_value: 180.0,
          max_value: 220.0,
          std_dev: 12.0,
          q10: 185.0,
          q25: 190.0,
          q75: 210.0,
          q90: 215.0,
          q95: 218.0,
          q99: 219.0,
          last_value: 202.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(100.0); // First value
      expect(result.targets).toHaveLength(2);
    });

    it('should handle metric name filter', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();
      const metricNameFilter = 'cpu_usage_specific';

      const mockMetricStats = [
        {
          metric_name: 'cpu_usage_specific',
          mean: 65.0,
          median: 65.0,
          min_value: 50.0,
          max_value: 80.0,
          std_dev: 8.0,
          q10: 55.0,
          q25: 60.0,
          q75: 70.0,
          q90: 75.0,
          q95: 78.0,
          q99: 79.0,
          last_value: 66.0,
          count: 80,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark, metricNameFilter);

      // Assert
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].target).toBe('cpu_usage_specific');
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('metric_name = $4'),
        ['test-run-1', 'app-dash-1', 1, 'cpu_usage_specific']
      );
    });

    it('should return null when no metrics found and validate_with_default_if_no_data is false', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ validate_with_default_if_no_data: false });

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBeNull();
      expect(result.targets).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No metrics data found')
      );
    });

    it('should create artificial metric when validate_with_default_if_no_data is true', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({
        validate_with_default_if_no_data: true,
        validate_with_default_if_no_data_value: 50.0,
      });

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(50.0);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({
        target: 'default',
        value: 50.0,
        isArtificial: true,
      });
      expect(mockManager.query).toHaveBeenCalledTimes(2); // 1 for select, 1 for insert
      expect(mockManager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO ds_metric_statistics'),
        expect.arrayContaining(['test-run-1', 'app-dash-1', 'dash-1', 1, 'CPU Usage', 'metrics', 'default', 50.0])
      );
    });

    it('should use default value of 0 when no default value specified', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({
        validate_with_default_if_no_data: true,
        validate_with_default_if_no_data_value: null,
      });

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(0.0);
      expect(result.targets[0].value).toBe(0.0);
    });

    it('should detect and handle artificial metrics from constant statistics', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      const mockMetricStats = [
        {
          metric_name: 'default',
          mean: 50.0,
          median: 50.0,
          min_value: 50.0,
          max_value: 50.0,
          std_dev: 0.0,
          q10: 50.0,
          q25: 50.0,
          q75: 50.0,
          q90: 50.0,
          q95: 50.0,
          q99: 50.0,
          last_value: 50.0,
          count: 1,
          is_constant: true, // Artificial metric
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(50.0);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].isArtificial).toBe(true);
    });

    // Series grouping (docs/design/2026-11-01-series-grouping-plan.md, Task 4): a grouped panel
    // that collapses to ONE constant group — e.g. a memory limit identical on every pod — becomes
    // the artificial `default` target exactly like any single-constant-series panel. Pinned so
    // the interaction is documented rather than discovered: the target is not named after the group.
    it('treats a single constant group like any single constant series (artificial default target)', async () => {
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();
      mockManager.query.mockResolvedValue([
        {
          metric_name: 'api',
          mean: 512, median: 512, min_value: 512, max_value: 512, std_dev: 0,
          q10: 512, q25: 512, q75: 512, q90: 512, q95: 512, q99: 512, last_value: 512,
          count: 30, is_constant: true, all_missing: false, pct_missing: 0,
        },
      ]);

      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      expect(result.targets).toEqual([{ target: 'default', value: 512, isArtificial: true }]);
      expect(result.panel_average).toBe(512);
    });

    it('should throw error when benchmark has no panel ID', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ configuration: null });

      // Act & Assert
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        DataAggregationError
      );
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        'No panel ID found in benchmark'
      );
    });

    it('should throw error on database query failure', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      mockManager.query.mockRejectedValue(new Error('Database connection error'));

      // Act & Assert
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        DataAggregationError
      );
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        'Failed to aggregate metrics'
      );
    });

    it('should return empty result when no valid metric values', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      const mockMetricStats = [
        {
          metric_name: null, // Invalid metric name
          mean: 75.0,
          median: 74.0,
          min_value: 50.0,
          max_value: 95.0,
          std_dev: 10.0,
          q10: 60.0,
          q25: 68.0,
          q75: 82.0,
          q90: 88.0,
          q95: 91.0,
          q99: 94.0,
          last_value: 76.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBeNull();
      expect(result.targets).toHaveLength(0);
    });
  });

  describe('trend evaluate type', () => {
    const stat = (metric_name: string, trend_pct_per_hour: number | null, trend_corr: number | null, count = 62) => ({
      metric_name, mean: 290, median: 285, min_value: 200, max_value: 400, std_dev: 30,
      q10: 0, q25: 0, q75: 0, q90: 0, q95: 0, q99: 0, last_value: 320, count,
      is_constant: false, all_missing: false, pct_missing: 0, trend_pct_per_hour, trend_corr,
    });

    it('judges a correlated slope, reports but does not judge a weak one, and keeps weak rows out of the average', async () => {
      const benchmark = createMockBenchmark({ evaluate_type: 'trend', average_all: true });
      mockManager.query.mockResolvedValue([
        stat('VolgendeCV', 26.4, 0.66),
        stat('MijnWerkNl', 20.2, 0.10),   // slope from outliers, r below the floor
        stat('Sparse', 30, 0.9, 5),       // too few points
        stat('OldRow', null, null),       // statistics written before the column existed
      ]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), benchmark);

      expect(result.targets).toEqual([
        { target: 'VolgendeCV', value: 26.4, isArtificial: false, weakTrend: false, trendCorr: 0.66 },
        { target: 'MijnWerkNl', value: 20.2, isArtificial: false, weakTrend: true, trendCorr: 0.10 },
        { target: 'Sparse', value: 30, isArtificial: false, weakTrend: true, trendCorr: 0.9 },
      ]);
      expect(result.panel_average).toBe(26.4);
    });

    it('applies the floors as boundaries: |r| >= 0.5 and count >= 10 are judged, a null r is weak', async () => {
      mockManager.query.mockResolvedValue([
        stat('AtCorrFloor', 5, 0.5, 10),        // exactly on both floors → judged
        stat('NegativeCorr', -5, -0.8, 62),     // falling series, |r| counts → judged
        stat('JustUnderCorr', 5, 0.49, 62),     // r below the floor → weak
        stat('JustUnderPoints', 5, 0.9, 9),     // one point short → weak
        stat('SlopeNoCorr', 5, null, 62),       // slope without r (constant time?) → weak
      ]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(), createMockBenchmark({ evaluate_type: 'trend' })
      );

      expect(result.targets.map((t) => [t.target, t.weakTrend])).toEqual([
        ['AtCorrFloor', false],
        ['NegativeCorr', false],
        ['JustUnderCorr', true],
        ['JustUnderPoints', true],
        ['SlopeNoCorr', true],
      ]);
      expect(result.targets[4].trendCorr).toBeNull();
      // Not average_all: the panel value is the FIRST JUDGED series, not the first row.
      expect(result.panel_average).toBe(5);
      // The read must ask for the two trend columns; a stale SELECT would silently mark every row weak.
      const sql = String(mockManager.query.mock.calls[0][0]);
      expect(sql).toContain('trend_pct_per_hour, trend_corr');
    });

    it('returns a null panel average when every series is weak, so average_all has nothing to judge', async () => {
      mockManager.query.mockResolvedValue([
        stat('Noisy', 40, 0.2),
        stat('Sparse', 90, 0.95, 3),
      ]);

      const averaged = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(), createMockBenchmark({ evaluate_type: 'trend', average_all: true })
      );
      expect(averaged.targets).toHaveLength(2);
      expect(averaged.targets.every((t) => t.weakTrend)).toBe(true);
      expect(averaged.panel_average).toBeNull();

      mockManager.query.mockResolvedValue([stat('Noisy', 40, 0.2)]);
      const single = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(), createMockBenchmark({ evaluate_type: 'trend', average_all: false })
      );
      expect(single.panel_average).toBeNull();
    });

    it('does not attach trend fields for a non-trend evaluate type even when the row carries them', async () => {
      mockManager.query.mockResolvedValue([stat('cpu', 26.4, 0.66)]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(), createMockBenchmark({ evaluate_type: 'mean' })
      );

      expect(result.targets).toEqual([{ target: 'cpu', value: 290, isArtificial: false }]);
      expect(result.panel_average).toBe(290);
    });
  });

  describe('perf-test error-rate panels read the pooled rollup ratio', () => {
    const SCENARIO_LABEL = 'Performance test metrics T_WG_Mijn_Vacatures';
    // dashboard_label is the pipeline-written label on the statistics row — that, not
    // the (nullable, user-editable) benchmark label, is what scopes the rollup read.
    const stat = (metric_name: string, mean: number, dashboard_label: string | null = SCENARIO_LABEL) => ({
      metric_name, mean, median: mean, min_value: 0, max_value: 100, std_dev: 0,
      q10: 0, q25: 0, q75: 0, q90: 0, q95: 0, q99: 0, last_value: mean,
      count: 117, is_constant: false, all_missing: false, pct_missing: 0, dashboard_label,
    });
    const perfBenchmark = (overrides?: Partial<Benchmark>) => createMockBenchmark({
      configuration: { id: 105 },
      dashboard_uid: 'performance-test-metrics-t-wg-mijn-vacatures',
      dashboard_label: 'Performance test metrics T_WG_Mijn_Vacatures',
      evaluate_type: 'avg',
      ...overrides,
    });

    it('replaces the bucket mean with SUM(failed)/SUM(total) from the rollup, scoped to the scenario', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('WG_VAC_16_Stuur_Email', 10.97), stat('WG_VAC_01_Home', 0)])
        .mockResolvedValueOnce([
          { metric_name: 'WG_VAC_16_Stuur_Email', pct: 7.49 },
        ]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      expect(result.targets).toEqual([
        { target: 'WG_VAC_16_Stuur_Email', value: 7.49, isArtificial: false },
        { target: 'WG_VAC_01_Home', value: 0, isArtificial: false }, // no rollup row → bucket mean kept
      ]);
      const [sql, params] = mockManager.query.mock.calls[1];
      expect(sql).toContain('FROM test_run_transaction_stats');
      expect(sql).toContain('ramp_up_excluded = true');
      expect(params).toEqual([
        'test-run-1', 'T_WG_Mijn_Vacatures', 'sut-1', 'production',
        'performance-test-metrics-t-wg-mijn-vacatures', null,
      ]);
    });

    it('uses the sampler rollup for panel 205 and the run-wide name on the all-aggregated dashboard', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('All aggregated', 3, 'Performance test metrics all aggregated')])
        .mockResolvedValueOnce([{ metric_name: 'All aggregated', pct: 1.5 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark({
        configuration: { id: 205 },
        dashboard_label: null as unknown as string, // nullable in the DDL; must not matter
        exclude_ramp_up_time: false, // inert for metric SLOs: the window is pinned to ramp-excluded
      }));

      expect(result.targets[0].value).toBe(1.5);
      const [sql, params] = mockManager.query.mock.calls[1];
      expect(sql).toContain('FROM test_run_sampler_stats');
      expect(sql).toContain('ramp_up_excluded = true');
      expect(params[1]).toBeNull();
      expect(params[5]).toBe('All aggregated');
    });

    it('leaves non-mean evaluate types and non-perf-test dashboards alone', async () => {
      mockManager.query.mockResolvedValueOnce([stat('x', 42)]);
      const max = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark({ evaluate_type: 'max' }));
      expect(max.targets[0].value).toBe(100);
      expect(mockManager.query).toHaveBeenCalledTimes(1);

      mockManager.query.mockResolvedValueOnce([stat('x', 42, 'Some Grafana board')]);
      const grafana = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());
      expect(grafana.targets[0].value).toBe(42);
      expect(mockManager.query).toHaveBeenCalledTimes(2);
    });

    it('does not consult the rollup for a perf-test panel that is not an error-rate panel', async () => {
      mockManager.query.mockResolvedValueOnce([stat('WG_VAC_01_Home', 312.5)]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark({ configuration: { id: 101 }, evaluate_type: 'mean' }),
      );

      expect(result.targets).toEqual([{ target: 'WG_VAC_01_Home', value: 312.5, isArtificial: false }]);
      expect(mockManager.query).toHaveBeenCalledTimes(1);
    });

    it('treats a missing evaluate_type as mean and takes the pooled path', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('WG_VAC_16_Stuur_Email', 10.97)])
        .mockResolvedValueOnce([{ metric_name: 'WG_VAC_16_Stuur_Email', pct: 7.49 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark({ evaluate_type: undefined as unknown as string }),
      );

      expect(result.targets[0].value).toBe(7.49);
      expect(mockManager.query).toHaveBeenCalledTimes(2);
    });

    it('keeps every bucket mean when the run has no rollup rows yet', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('WG_VAC_16_Stuur_Email', 10.97), stat('WG_VAC_01_Home', 0.5)])
        .mockResolvedValueOnce([]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      expect(result.targets.map((t) => t.value)).toEqual([10.97, 0.5]);
      expect(result.panel_average).toBe(10.97);
    });

    it('ignores a rollup row whose pct is NULL (zero total_count) and keeps the bucket mean', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('WG_VAC_16_Stuur_Email', 10.97)])
        .mockResolvedValueOnce([
          { metric_name: 'WG_VAC_16_Stuur_Email', pct: null },
        ]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      expect(result.targets).toEqual([{ target: 'WG_VAC_16_Stuur_Email', value: 10.97, isArtificial: false }]);
    });

    it('coerces a pct the driver returns as a string to a number', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('WG_VAC_16_Stuur_Email', 10.97)])
        .mockResolvedValueOnce([{ metric_name: 'WG_VAC_16_Stuur_Email', pct: '7.49' }]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      expect(result.targets[0].value).toBe(7.49);
      expect(typeof result.targets[0].value).toBe('number');
    });

    it('keeps the bucket mean for a series the rollup does not know and warns about it', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('stray', 3.2), stat('WG_VAC_16_Stuur_Email', 10.97)])
        .mockResolvedValueOnce([{ metric_name: 'WG_VAC_16_Stuur_Email', pct: 7.49 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      expect(result.targets).toEqual([
        { target: 'stray', value: 3.2, isArtificial: false },
        { target: 'WG_VAC_16_Stuur_Email', value: 7.49, isArtificial: false },
      ]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('1/2 series on panel 105'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('stray'));
    });

    it('passes the "default" scenario through and lets the SQL alias it to the rollup\'s empty scenario', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('Login', 4, 'Performance test metrics default')])
        .mockResolvedValueOnce([{ metric_name: 'Login', pct: 2 }]);

      await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark({ dashboard_uid: 'performance-test-metrics-default' }),
      );

      const [sql, params] = mockManager.query.mock.calls[1];
      expect(params[1]).toBe('default');
      expect(params[5]).toBeNull();
      expect(sql).toContain(`($2 = 'default' AND scenario_name = '')`);
      expect(sql).toContain('$2::text IS NULL OR scenario_name = $2');
    });

    it('scopes the rollup read to the perf-test metrics source and excludes ramp-up per the benchmark', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('Login', 4)])
        .mockResolvedValueOnce([]);

      await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      const [sql] = mockManager.query.mock.calls[1];
      expect(sql).toContain('ramp_up_excluded = true');
      expect(sql).toContain(`source_type = 'performance_test'`);
      expect(sql).toContain('system_under_test_id = $3 AND test_environment = $4 AND external_ref = $5');
      expect(sql).toContain('GROUP BY 1');
      expect(sql).toContain('ROUND((SUM(failed_count)::numeric / NULLIF(SUM(total_count), 0)) * 100, 2)::float');
      expect(sql).toContain('SELECT COALESCE($6::text, transaction_name) AS metric_name');
    });

    it('composes the sampler series name as transaction.sampler for panel 205', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('Login.POST /login', 4)])
        .mockResolvedValueOnce([{ metric_name: 'Login.POST /login', pct: 1.25 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark({ configuration: { id: 205 } }),
      );

      expect(result.targets[0].value).toBe(1.25);
      const [sql, params] = mockManager.query.mock.calls[1];
      expect(sql).toContain('FROM test_run_sampler_stats');
      expect(sql).toContain(`transaction_name IS NULL OR transaction_name IN ('', 'overall') OR transaction_name = sampler_name`);
      expect(sql).toContain(`transaction_name || '.' || sampler_name`);
      expect(params[1]).toBe('T_WG_Mijn_Vacatures');
      expect(params[5]).toBeNull();
    });

    it('averages the pooled values, not the bucket means, when average_all is set', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('A', 10), stat('B', 20)])
        .mockResolvedValueOnce([
          { metric_name: 'A', pct: 1 },
          { metric_name: 'B', pct: 3 },
        ]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark({ average_all: true }),
      );

      expect(result.panel_average).toBe(2);
      expect(result.targets.map((t) => t.value)).toEqual([1, 3]);
    });

    it('applies the pooled value to a single metric selected by metricNameFilter', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('WG_VAC_16_Stuur_Email', 10.97)])
        .mockResolvedValueOnce([
          { metric_name: 'WG_VAC_16_Stuur_Email', pct: 7.49 },
          { metric_name: 'WG_VAC_01_Home', pct: 0.1 },
        ]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark(),
        'WG_VAC_16_Stuur_Email',
      );

      expect(result.targets).toEqual([{ target: 'WG_VAC_16_Stuur_Email', value: 7.49, isArtificial: false }]);
      const [statsSql, statsParams] = mockManager.query.mock.calls[0];
      expect(statsSql).toContain('metric_name = $4');
      expect(statsParams).toEqual(['test-run-1', 'app-dash-1', 105, 'WG_VAC_16_Stuur_Email']);
    });

    it('shifts the statistics params for organization_id without touching the rollup params', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('Login', 4)])
        .mockResolvedValueOnce([{ metric_name: 'Login', pct: 2 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun({ organization_id: 'org-1' } as Partial<TestRun>),
        perfBenchmark(),
      );

      expect(result.targets[0].value).toBe(2);
      const [statsSql, statsParams] = mockManager.query.mock.calls[0];
      expect(statsParams).toEqual(['test-run-1', 'app-dash-1', 105, 'org-1', 'org-1']);
      expect(statsSql).toContain('organization_id = $4 OR organization_id IS NULL');
      expect(statsSql).toContain('organization_id = $5 OR organization_id IS NULL');
      const [, rollupParams] = mockManager.query.mock.calls[1];
      expect(rollupParams).toEqual([
        'test-run-1', 'T_WG_Mijn_Vacatures', 'sut-1', 'production',
        'performance-test-metrics-t-wg-mijn-vacatures', null,
      ]);
    });

    it('still returns the artificial statistic untouched when the run has no rollup', async () => {
      mockManager.query
        .mockResolvedValueOnce([{ ...stat('default', 0), is_constant: true, count: 1 }])
        .mockResolvedValueOnce([]);

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      expect(result).toEqual({
        panel_average: 0,
        targets: [{ target: 'default', value: 0, isArtificial: true }],
      });
      expect(mockManager.query).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('does not warn for a bare sampler on panel 205 — the rollup drops NULL-transaction rows by design', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('POST /health', 2), stat('Login.POST /login', 4), stat('Pay.charge', 6)])
        .mockResolvedValueOnce([{ metric_name: 'Login.POST /login', pct: 1.25 }]);

      const result = await aggregator.aggregateMetricsForBenchmark(
        createMockTestRun(),
        perfBenchmark({ configuration: { id: 205 } }),
      );

      expect(result.targets.map((t) => t.value)).toEqual([2, 1.25, 6]);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('1/3 series on panel 205'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Pay.charge'));
      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('POST /health'));
    });

    it('degrades to the bucket mean when the rollup read fails, and logs the cause', async () => {
      mockManager.query
        .mockResolvedValueOnce([stat('Login', 4)])
        .mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));

      const result = await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      // The check still produces a verdict — on the number it used before this fix.
      expect(result.targets).toEqual([{ target: 'Login', value: 4, isArtificial: false }]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Pooled error rate read failed for panel 105'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Login'));
    });

    it('does not suppress the warning for a real series that happens to be constant', async () => {
      mockManager.query
        .mockResolvedValueOnce([{ ...stat('AlwaysFails', 100), is_constant: true }])
        .mockResolvedValueOnce([]);

      await aggregator.aggregateMetricsForBenchmark(createMockTestRun(), perfBenchmark());

      // one is_constant row would otherwise take the artificial early-return; assert the warn fired first
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('AlwaysFails'));
    });
  });

  describe('Field Mapping and Value Extraction', () => {
    it('should correctly map aggregation types to field names', () => {
      // Arrange
      const mappings = [
        { type: 'mean', expected: 'mean' },
        { type: 'median', expected: 'median' },
        { type: 'min', expected: 'min_value' },
        { type: 'max', expected: 'max_value' },
        { type: 'q90', expected: 'q90' },
        { type: 'q95', expected: 'q95' },
        { type: 'q99', expected: 'q99' },
        { type: 'last', expected: 'last_value' },
        { type: 'std', expected: 'std_dev' },
      ];

      // Act & Assert
      for (const { type, expected } of mappings) {
        const result = (aggregator as any).mapAggregationTypeToField(type);
        expect(result).toBe(expected);
      }
    });

    it('should default to mean for unknown aggregation type', () => {
      // Act
      const result = (aggregator as any).mapAggregationTypeToField('unknown_type');

      // Assert
      expect(result).toBe('mean');
    });

    it('should handle case-insensitive aggregation types', () => {
      // Act
      const result1 = (aggregator as any).mapAggregationTypeToField('MEAN');
      const result2 = (aggregator as any).mapAggregationTypeToField('Q95');

      // Assert
      expect(result1).toBe('mean');
      expect(result2).toBe('q95');
    });

    it('should extract correct field values from metric statistics', () => {
      // Arrange
      const mockStat = {
        metric_name: 'test_metric',
        mean: 100.0,
        median: 95.0,
        min_value: 50.0,
        max_value: 150.0,
        std_dev: 20.0,
        q10: 60.0,
        q25: 75.0,
        q75: 125.0,
        q90: 140.0,
        q95: 145.0,
        q99: 148.0,
        last_value: 102.0,
        count: 200,
        is_constant: false,
        all_missing: false,
        pct_missing: 0.0,
      };

      // Act & Assert
      expect((aggregator as any).getFieldValue(mockStat, 'mean')).toBe(100.0);
      expect((aggregator as any).getFieldValue(mockStat, 'median')).toBe(95.0);
      expect((aggregator as any).getFieldValue(mockStat, 'min_value')).toBe(50.0);
      expect((aggregator as any).getFieldValue(mockStat, 'max_value')).toBe(150.0);
      expect((aggregator as any).getFieldValue(mockStat, 'q95')).toBe(145.0);
      expect((aggregator as any).getFieldValue(mockStat, 'last_value')).toBe(102.0);
      expect((aggregator as any).getFieldValue(mockStat, 'std_dev')).toBe(20.0);
    });

    it('should default to mean for unknown field name', () => {
      // Arrange
      const mockStat = {
        metric_name: 'test_metric',
        mean: 100.0,
        median: 95.0,
        min_value: 50.0,
        max_value: 150.0,
        std_dev: 20.0,
        q10: 60.0,
        q25: 75.0,
        q75: 125.0,
        q90: 140.0,
        q95: 145.0,
        q99: 148.0,
        last_value: 102.0,
        count: 200,
        is_constant: false,
        all_missing: false,
        pct_missing: 0.0,
      };

      // Act
      const result = (aggregator as any).getFieldValue(mockStat, 'unknown_field');

      // Assert
      expect(result).toBe(100.0); // Defaults to mean
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty panel configuration object', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ configuration: {} as any });

      // Act & Assert
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        DataAggregationError
      );
    });

    it('should handle metrics with null values gracefully', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      const mockMetricStats = [
        {
          metric_name: 'metric_with_null',
          mean: null, // Null value
          median: null,
          min_value: null,
          max_value: null,
          std_dev: null,
          q10: null,
          q25: null,
          q75: null,
          q90: null,
          q95: null,
          q99: null,
          last_value: null,
          count: 0,
          is_constant: false,
          all_missing: true,
          pct_missing: 100.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBeNull();
      expect(result.targets).toHaveLength(0);
    });

    it('should handle multiple metrics with mixed validity', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ average_all: true });

      const mockMetricStats = [
        {
          metric_name: 'valid_metric',
          mean: 100.0,
          median: 100.0,
          min_value: 80.0,
          max_value: 120.0,
          std_dev: 10.0,
          q10: 85.0,
          q25: 90.0,
          q75: 110.0,
          q90: 115.0,
          q95: 118.0,
          q99: 119.0,
          last_value: 101.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
        {
          metric_name: null, // Invalid - null name
          mean: 200.0,
          median: 200.0,
          min_value: 180.0,
          max_value: 220.0,
          std_dev: 12.0,
          q10: 185.0,
          q25: 190.0,
          q75: 210.0,
          q90: 215.0,
          q95: 218.0,
          q99: 219.0,
          last_value: 202.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.targets).toHaveLength(1); // Only the valid metric
      expect(result.panel_average).toBe(100.0);
    });
  });
});
