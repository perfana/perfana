import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { withRequestEm } from '../../../common/db/request-em';
import { resolveTestRunUuid } from './resolve-test-run';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { withOrgFilter } from '../../../common/utils/with-org-filter';
import { percentDiff } from '../renderers/comparison-bands';
import { ALL_AGGREGATED_SERIES, aggregatedKindFor, getUrlPanel, isRequestPanel, isUrlPanel, perfPanelTitle } from './url-perf-panels';
import { CHANGE_POINT_WINDOW } from './trend-window';

// The shapes these queries return. Re-exported so the ten renderers that import them from
// this module keep working unchanged.
import {
  AdaptResultRow,
  AnomalySummary,
  ApdexData,
  ApdexScenarioData,
  ApdexTransactionRow,
  AwrData,
  AwrInsightSummary,
  AwrReportSummary,
  BaselineComparisonData,
  BaselineComparisonSelection,
  MetricTrendSeries,
  BaselineComparisonRow,
  MetricsPanelSelector,
  MetricsTimeSeriesPanel,
  MetricsTimeSeriesRow,
  RawTop10Row,
  RegressionsData,
  RegressionsMetric,
  ScenarioData,
  SloCheckResult,
  SloSummary,
  ThroughputScenarioRow,
  ThroughputStats,
  Top10Row,
  TransactionRow,
  TrendRunSummary,
  TrendsData,
  VirtualUserScenarioRow,
  VirtualUserStats,
} from './report-data.types';
export * from './report-data.types';

/** Derive Top10Row metrics from raw stat rows (formulas match prepareTop10Data). */
export function mapRawToTop10Rows(raw: RawTop10Row[], testDuration: number): Top10Row[] {
  const duration = testDuration > 0 ? testDuration : 1;
  return raw.map((r) => {
    const avg = Number(r.avg_response_time) || 0;
    const total = Number(r.total_count) || 0;
    const failed = Number(r.failed_count) || 0;
    const scenario = r.scenario_name && r.scenario_name.length > 0 ? r.scenario_name : 'No Scenario';
    return {
      label: r.label,
      secondaryLabel: r.secondary_label ?? undefined,
      scenarioName: scenario,
      avgResponseTime: avg,
      callCount: total,
      errorCount: failed,
      errorRate: total > 0 ? (failed / total) * 100 : 0,
      throughput: total / duration,
      impact: avg * total,
    };
  });
}

/**
 * Service for fetching report data from database
 *
 * Handles all database queries for report generation including:
 * - Scenario data (transactions, time series)
 * - Apdex metrics (overall and per-scenario)
 * - Throughput statistics (transactions/sec, requests/sec)
 * - Virtual user statistics (peak and average)
 * - Mock data for previews
 *
 * All methods support organization-based multi-tenancy filtering:
 * - Admin users bypass organization filtering
 * - Non-admin users only see data for test runs belonging to their organizations
 * - Organizations are loaded from AuthorizationService (cached via Redis)
 */
@Injectable()
export class ReportDataFetcherService {
  private readonly logger = new Logger(ReportDataFetcherService.name);

  constructor(
    @InjectRepository(TestRun)
    private readonly testRunRepo: Repository<TestRun>,
    private readonly authzService: AuthorizationService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Build organization filter SQL clause for test_runs table queries.
   * Uses tr.organization_id directly (not via systems_under_test → teams join).
   * Includes backward compatibility: legacy data (NULL organization_id) is always accessible.
   *
   * @returns SQL clause and parameter array
   */
  private buildOrganizationFilterClause(
    paramStartIndex: number,
    organizationIds: string[],
    testRunAlias: string = 'tr',
  ): { clause: string; params: string[] } {
    // Callers reach here only for a real, non-admin user: `resolveOrgFilter` returns
    // an empty clause for system calls (no userId) and for global admins. So an empty
    // list means a user with zero memberships, who must see nothing.
    //
    // This used to read `organization_id IS NULL` on both branches, framed as a legacy
    // -data allowance. Phase 4 made the column NOT NULL, so that matched no real row —
    // only a LEFT JOIN miss, which is exactly the row another tenant must not see.
    if (organizationIds.length === 0) {
      return { clause: 'AND FALSE', params: [] };
    }

    const placeholders = organizationIds.map((_, i) => `$${paramStartIndex + i}`).join(', ');
    const clause = `AND ${testRunAlias}.organization_id IN (${placeholders})`;

    return { clause, params: organizationIds };
  }

  /**
   * Resolve an organization filter clause for a query, accounting for anonymous
   * (no userId — internal/system calls) and global-admin bypass paths.
   *
   * Returns an empty clause when filtering should be skipped (anonymous OR admin),
   * and the org-scoped clause + params otherwise.
   */
  private async resolveOrgFilter(
    userId: string,
    roles: string[],
    paramStartIndex: number,
    testRunAlias: string = 'tr',
  ): Promise<{ clause: string; params: string[] }> {
    if (!userId) return { clause: '', params: [] };
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    if (orgIds === null) return { clause: '', params: [] };
    return this.buildOrganizationFilterClause(paramStartIndex, orgIds, testRunAlias);
  }

  /**
   * Get ramp-up cutoff time for a test run
   * @param testRunId - Test run ID
   * @param excludeRampUp - Whether to exclude ramp-up period
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Cutoff time or null if not excluding ramp-up
   */
  async getRampUpCutoffTime(
    testRunId: string,
    excludeRampUp: boolean,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Date | null> {
    if (!excludeRampUp) return null;

    // Internal/system calls (no userId) or admin users bypass org filtering
    const orgFilter = await this.resolveOrgFilter(userId, roles, 2, 'tr');

    const query = `
      SELECT tr.start_time, tr.ramp_up
      FROM test_runs tr
      WHERE tr.test_run_id = $1
      ${orgFilter.clause}
    `;
    const result = await withRequestEm(this.testRunRepo).query(query, [testRunId, ...orgFilter.params]);

    if (result[0]?.start_time && result[0]?.ramp_up) {
      const startTime = new Date(result[0].start_time);
      const analysisStartOffsetSeconds = parseInt(result[0].ramp_up);
      return new Date(startTime.getTime() + analysisStartOffsetSeconds * 1000);
    }

    return null;
  }

  /**
   * Get scenario data from database including transactions and time series
   * @param testRun - Test run entity
   * @param scenarioName - Scenario name to fetch
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Scenario data with transactions and time series, or null if not found
   */
  async getScenarioDataFromDatabase(
    testRun: TestRun,
    scenarioName: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<ScenarioData | null> {
    try {
      // Build organization filter for test_run validation
      const orgFilter = await this.resolveOrgFilter(userId, roles, 3, 'tr');

      // Query transactions for this test run and scenario with organization filtering
      const query = `
        SELECT
          txn.transaction_name,
          ROUND(AVG(txn.response_time)::numeric, 2) as avg_ms,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY txn.response_time)::numeric, 2) as p95_ms,
          ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY txn.response_time)::numeric, 2) as p99_ms,
          COUNT(CASE WHEN txn.success = true THEN 1 END) as pass,
          COUNT(CASE WHEN txn.success = false THEN 1 END) as fail,
          COUNT(*) as total
        FROM transactions txn
        JOIN test_runs tr ON tr.test_run_id = txn.test_run_id
        WHERE txn.test_run_id = $1
          AND txn.scenario_name = $2
          ${orgFilter.clause}
        GROUP BY txn.transaction_name
        ORDER BY txn.transaction_name
      `;

      const transactions = await withRequestEm(this.testRunRepo).query(query, [testRun.testRunId, scenarioName, ...orgFilter.params]);

      if (!transactions || transactions.length === 0) {
        return null;
      }

      // Query time-series data for the chart with organization filtering
      const timeSeriesQuery = `
        SELECT
          txn.transaction_name,
          time_bucket('1 minute', txn.time) as time_bucket,
          AVG(txn.response_time) as avg_response_time
        FROM transactions txn
        JOIN test_runs tr ON tr.test_run_id = txn.test_run_id
        WHERE txn.test_run_id = $1
          AND txn.scenario_name = $2
          ${orgFilter.clause}
        GROUP BY txn.transaction_name, time_bucket
        ORDER BY txn.transaction_name, time_bucket
      `;

      const timeSeriesData = await withRequestEm(this.testRunRepo).query(timeSeriesQuery, [testRun.testRunId, scenarioName, ...orgFilter.params]);

      // Format data for chart rendering
      return {
        scenario: scenarioName,
        transactions: transactions.map((txn: TransactionRow) => ({
          name: txn.transaction_name,
          avgMs: parseFloat(txn.avg_ms) || 0,
          p95Ms: parseFloat(txn.p95_ms) || 0,
          p99Ms: parseFloat(txn.p99_ms) || 0,
          pass: parseInt(txn.pass) || 0,
          fail: parseInt(txn.fail) || 0,
          errPct: parseInt(txn.total) > 0 ? ((parseInt(txn.fail) / parseInt(txn.total)) * 100) : 0,
        })),
        timeSeries: timeSeriesData,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch scenario data for ${scenarioName}:`, error);
      return null;
    }
  }

  /**
   * Ranked transaction rows for the Top 10 Lists section (transactions scope).
   * Aggregated per (transaction, scenario) from test_run_transaction_stats.
   */
  async getTop10TransactionRows(
    testRun: TestRun,
    scenarios: string[],
    excludeRampUp: boolean,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Top10Row[]> {
    const params: unknown[] = [testRun.testRunId, excludeRampUp];
    let scenarioClause = '';
    if (scenarios.length > 0) {
      params.push(scenarios);
      scenarioClause = `AND COALESCE(NULLIF(trs.scenario_name, ''), 'No Scenario') = ANY($${params.length})`;
    }
    const orgFilter = await this.resolveOrgFilter(userId, roles, params.length + 1, 'tr');
    params.push(...orgFilter.params);

    const query = `
      SELECT
        trs.transaction_name        AS label,
        NULL::text                  AS secondary_label,
        trs.scenario_name,
        trs.avg_response_time,
        trs.total_count,
        trs.failed_count
      FROM test_run_transaction_stats trs
      JOIN test_runs tr ON tr.test_run_id = trs.test_run_id
      WHERE trs.test_run_id = $1
        AND trs.ramp_up_excluded = $2
        AND trs.total_count > 0
        ${scenarioClause}
        ${orgFilter.clause}
    `;
    const rows: RawTop10Row[] = await withRequestEm(this.testRunRepo).query(query, params);
    return mapRawToTop10Rows(rows, testRun.duration ?? 1);
  }

  /**
   * Ranked sampler rows for the Top 10 Lists section (requests / urls scope).
   * requests: one row per sampler, url pattern as secondary_label.
   * urls (groupByUrl): aggregated per (url pattern, scenario), weighted avg RT.
   */
  async getTop10SamplerRows(
    testRun: TestRun,
    scenarios: string[],
    excludeRampUp: boolean,
    groupByUrl: boolean,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Top10Row[]> {
    const params: unknown[] = [testRun.testRunId, excludeRampUp];
    let scenarioClause = '';
    if (scenarios.length > 0) {
      params.push(scenarios);
      scenarioClause = `AND COALESCE(NULLIF(trss.scenario_name, ''), 'No Scenario') = ANY($${params.length})`;
    }
    const orgFilter = await this.resolveOrgFilter(userId, roles, params.length + 1, 'tr');
    params.push(...orgFilter.params);

    const urlExpr = `COALESCE(LOWER(up.normalized_url), trss.sampler_name)`;
    const query = groupByUrl
      ? `
        SELECT
          ${urlExpr}                 AS label,
          NULL::text                 AS secondary_label,
          trss.scenario_name,
          ROUND((SUM(trss.avg_response_time * trss.total_count) / NULLIF(SUM(trss.total_count), 0))::numeric, 2) AS avg_response_time,
          SUM(trss.total_count)      AS total_count,
          SUM(trss.failed_count)     AS failed_count
        FROM test_run_sampler_stats trss
        JOIN test_runs tr ON tr.test_run_id = trss.test_run_id
        LEFT JOIN url_patterns up
          ON  up.url_hash          = trss.url_hash
          AND up.system_under_test = trss.system_under_test
          AND up.test_environment  = trss.test_environment
        WHERE trss.test_run_id = $1
          AND trss.ramp_up_excluded = $2
          AND trss.total_count > 0
          ${scenarioClause}
          ${orgFilter.clause}
        GROUP BY label, trss.scenario_name
      `
      : `
        SELECT
          trss.sampler_name          AS label,
          LOWER(up.normalized_url)   AS secondary_label,
          trss.scenario_name,
          trss.avg_response_time,
          trss.total_count,
          trss.failed_count
        FROM test_run_sampler_stats trss
        JOIN test_runs tr ON tr.test_run_id = trss.test_run_id
        LEFT JOIN url_patterns up
          ON  up.url_hash          = trss.url_hash
          AND up.system_under_test = trss.system_under_test
          AND up.test_environment  = trss.test_environment
        WHERE trss.test_run_id = $1
          AND trss.ramp_up_excluded = $2
          AND trss.total_count > 0
          ${scenarioClause}
          ${orgFilter.clause}
      `;
    const rows: RawTop10Row[] = await withRequestEm(this.testRunRepo).query(query, params);
    return mapRawToTop10Rows(rows, testRun.duration ?? 1);
  }

  /**
   * Run-wide aggregate time-series across ALL transactions (no GROUP BY
   * transaction_name) — the same aggregate the /aggregated-metric-timeseries
   * endpoint produces, for report rendering.
   * Re-derived (not a literal copy) from TestRunsPerformanceQueryService.getAggregatedMetricTimeseries:
   * that endpoint uses TimescaleDB approx_percentile(percentile_agg(...)), while this uses core-Postgres
   * PERCENTILE_CONT WITHIN GROUP (exact, sort-based), so p95/p99 values here will differ slightly from
   * the endpoint's. avg is computed the same way either way, so it matches exactly.
   */
  async getAggregatedSeries(
    testRunId: string,
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage',
    stat: 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max',
    excludeRampUp: boolean = true,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ time: Date; value: number }[]> {
    const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp, userId, roles);
    // params: $1 testRunId, $2 cutoff; org params start at $3
    const orgFilter = await this.resolveOrgFilter(userId, roles, 3, 'tr');

    const statExprMap: Record<typeof stat, string> = {
      avg: 'ROUND(AVG(t.response_time)::numeric, 2)',
      p50: 'ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      p90: 'ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      p95: 'ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      p99: 'ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2)',
      max: 'MAX(t.response_time)::numeric',
    };

    let query: string;
    if (metric === 'error_percentage') {
      query = `
        SELECT date_trunc('minute', t.time) AS time,
          ROUND(COUNT(*) FILTER (WHERE NOT t.success)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS value
        FROM requests_raw t
        JOIN test_runs tr ON tr.test_run_id = t.test_run_id
        WHERE t.test_run_id = $1
          AND ($2::timestamptz IS NULL OR t.time >= $2::timestamptz)
          ${orgFilter.clause}
        GROUP BY 1
        ORDER BY 1
      `;
    } else {
      const table = metric === 'transaction_response_time' ? 'transactions' : 'requests_raw';
      query = `
        SELECT date_trunc('minute', t.time) AS time, ${statExprMap[stat]} AS value
        FROM ${table} t
        JOIN test_runs tr ON tr.test_run_id = t.test_run_id
        WHERE t.test_run_id = $1
          AND ($2::timestamptz IS NULL OR t.time >= $2::timestamptz)
          ${orgFilter.clause}
        GROUP BY 1
        ORDER BY 1
      `;
    }

    const rows: Array<{ time: string; value: string | null }> =
      await withRequestEm(this.testRunRepo).query(query, [testRunId, cutoffTime, ...orgFilter.params]);
    return rows.map((r) => ({ time: new Date(r.time), value: r.value == null ? 0 : Number(r.value) }));
  }

  /**
   * Run-wide scalar aggregate across ALL transactions for the comparison table
   * (single row, no GROUP BY).
   */
  async getAggregatedScalars(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ avg: number | null; p90: number | null; p95: number | null; p99: number | null; pass: number; fail: number }> {
    const orgFilter = await this.resolveOrgFilter(userId, roles, 2, 'tr');
    const query = `
      SELECT
        ROUND(AVG(t.response_time)::numeric, 2) AS avg,
        ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) AS p90,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) AS p95,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) AS p99,
        COUNT(*) FILTER (WHERE t.success) AS pass,
        COUNT(*) FILTER (WHERE NOT t.success) AS fail
      FROM transactions t
      JOIN test_runs tr ON tr.test_run_id = t.test_run_id
      WHERE t.test_run_id = $1
        ${orgFilter.clause}
    `;
    const rows: Array<Record<string, string | null>> =
      await withRequestEm(this.testRunRepo).query(query, [testRunId, ...orgFilter.params]);
    const r = rows[0] ?? {};
    const num = (v: string | null | undefined) => (v == null ? null : Number(v));
    return {
      avg: num(r.avg),
      p90: num(r.p90),
      p95: num(r.p95),
      p99: num(r.p99),
      pass: Number(r.pass ?? 0),
      fail: Number(r.fail ?? 0),
    };
  }

  /**
   * The start of a trend window.
   *
   * `CHANGE_POINT_WINDOW` follows ADAPT: its control group records the run at which the
   * system last changed behaviour, which is the point past which older runs are comparing
   * against a different system. Any other value is a run id the reader pinned. Null means
   * "no floor" — the caller's run count decides.
   */
  private async resolveTrendWindowStart(
    testRun: TestRun,
    oldestTestRunId?: string,
  ): Promise<Date | null> {
    if (!oldestTestRunId) return null;

    let runId = oldestTestRunId;
    if (oldestTestRunId === CHANGE_POINT_WINDOW) {
      const rows: Array<{ test_run_id: string | null }> = await this.dataSource.query(
        `SELECT g.change_point->>'test_run_id' AS test_run_id
         FROM ds_adapt_conclusion c
         JOIN ds_control_groups g ON g.control_group_id = c.control_group_id
         WHERE c.test_run_id = $1
         LIMIT 1`,
        [testRun.testRunId],
      );
      const found = rows[0]?.test_run_id;
      // No change point recorded yet — fall back to the run count rather than the whole history.
      if (!found) return null;
      runId = found;
    }

    const rows: Array<{ start_time: string | null }> = await withRequestEm(this.testRunRepo).query(
      `SELECT start_time FROM test_runs WHERE test_run_id = $1 LIMIT 1`,
      [runId],
    );
    const startTime = rows[0]?.start_time;
    return startTime ? new Date(startTime) : null;
  }

  /**
   * Run-wide request response times, the request-side twin of getAggregatedScalars.
   *
   * Reads the sampler rollup rather than raw rows: `pct_agg` is the stored percentile sketch,
   * so rolling it up over every sampler gives the run's distribution without re-reading
   * millions of requests.
   */
  async getAggregatedRequestScalars(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ avg: number | null; p90: number | null; p95: number | null; p99: number | null }> {
    const orgFilter = await this.resolveOrgFilter(userId, roles, 2, 'tr');
    const rows: Array<Record<string, string | null>> = await withRequestEm(this.testRunRepo).query(
      `WITH agg AS (
         SELECT rollup(s.pct_agg) AS pct_agg,
                SUM(s.avg_response_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg
         FROM test_run_sampler_stats s
         JOIN test_runs tr ON tr.test_run_id = s.test_run_id
         WHERE s.test_run_id = $1
           AND s.ramp_up_excluded = true
           AND s.total_count > 0
           ${orgFilter.clause}
       )
       SELECT ROUND(a.avg::numeric, 2) AS avg,
              ROUND(approx_percentile(0.90, a.pct_agg)::numeric, 2) AS p90,
              ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95,
              ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99
       FROM agg a`,
      [testRunId, ...orgFilter.params],
    );
    const r = rows[0] ?? {};
    const num = (v: string | null | undefined) => (v == null ? null : Number(v));
    return { avg: num(r.avg), p90: num(r.p90), p95: num(r.p95), p99: num(r.p99) };
  }

  /**
   * The "All aggregated" rows a selection asked for: one per panel whose series list carries
   * the sentinel, holding the run-wide aggregate instead of a single series.
   */
  private async getAggregatedSeriesRows(
    currentRunId: string,
    baselineRunId: string,
    selections: BaselineComparisonSelection[],
    opts: { metrics: ('avg' | 'p90' | 'p95' | 'p99')[]; userId: string; roles: string[] },
  ): Promise<BaselineComparisonRow[]> {
    const wanted = selections.filter(
      (s) => s.metricNames?.includes(ALL_AGGREGATED_SERIES) && aggregatedKindFor(s.panelId),
    );
    if (wanted.length === 0) return [];

    const kinds = new Set(wanted.map((s) => aggregatedKindFor(s.panelId)!));
    const scalars = new Map<string, { avg: number | null; p90: number | null; p95: number | null; p99: number | null }>();
    for (const kind of kinds) {
      const [cur, base] = await Promise.all(
        [currentRunId, baselineRunId].map((run) => (kind === 'transaction'
          ? this.getAggregatedScalars(run, opts.userId, opts.roles)
          : this.getAggregatedRequestScalars(run, opts.userId, opts.roles))),
      );
      scalars.set(`${kind}:current`, cur!);
      scalars.set(`${kind}:baseline`, base!);
    }

    return wanted.map((sel) => {
      const kind = aggregatedKindFor(sel.panelId)!;
      const cur = scalars.get(`${kind}:current`)!;
      const base = scalars.get(`${kind}:baseline`)!;
      return {
        group: `${sel.dashboardLabel} / ${perfPanelTitle(sel.panelId ?? null, '')}`,
        dashboardLabel: sel.dashboardLabel,
        panelTitle: perfPanelTitle(sel.panelId ?? null, ''),
        label: ALL_AGGREGATED_SERIES,
        metrics: opts.metrics.map((k) => ({
          key: k, current: cur[k], baseline: base[k], diffPercent: percentDiff(cur[k], base[k]),
        })),
      };
    });
  }

  /**
   * Get Apdex data from database for all scenarios
   *
   * IMPORTANT: This method uses WEIGHTED AVERAGES of per-transaction percentiles
   * to match how the Performance Analysis card calculates aggregated metrics.
   *
   * Why weighted averages instead of global percentiles:
   * - Global PERCENTILE_CONT across all transactions is misleading when transaction types
   *   have vastly different performance characteristics and volumes
   * - Example: 1000 fast transactions (50ms) + 100 slow transactions (500ms)
   *   - Global P95: ~100ms (dominated by high-volume fast transactions)
   *   - Weighted avg of per-transaction P95s: more representative of actual user experience
   * - This matches how analysts naturally aggregate metrics in Performance Analysis
   *
   * @param testRun - Test run to fetch data for
   * @param apdexThreshold - Apdex threshold T in milliseconds
   * @param excludeRampUp - Whether to exclude ramp-up period from calculations
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Apdex data structure with overall and per-scenario metrics
   */
  async getApdexDataFromDatabase(
    testRun: TestRun,
    _apdexThreshold: number,
    excludeRampUp: boolean = false,
    userId: string = '',
    roles: string[] = [],
  ): Promise<ApdexData | null> {
    try {
      const testRunId = testRun.testRunId;

      // Get ramp-up cutoff time if needed (pass userId/roles for org filtering)
      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp, userId, roles);

      // Build organization filter for queries
      // Base params are: [testRunId, excludeRampUp, cutoffTime] = indices 1, 2, 3
      // Organization params start at index 4
      const orgFilter = await this.resolveOrgFilter(userId, roles, 4, 'tr');

      // Note: apdexThreshold parameter no longer used in query - we fetch per-transaction thresholds from DB
      const queryParams = cutoffTime
        ? [testRunId, excludeRampUp, cutoffTime, ...orgFilter.params]
        : [testRunId, excludeRampUp, null, ...orgFilter.params];

      // Query all per-transaction statistics first (this matches Performance Analysis approach)
      // We get per-transaction percentiles, then calculate weighted averages for overall/scenario summaries
      // IMPORTANT: Use per-transaction Apdex thresholds from database (not global threshold)
      const allTransactionsQuery = `
        SELECT
          t.transaction_name,
          t.scenario_name,
          COUNT(*) as total,
          COUNT(CASE WHEN t.success = true THEN 1 END) as pass,
          COUNT(CASE WHEN t.success = false THEN 1 END) as fail,
          ROUND(AVG(t.response_time)::numeric, 2) as avg_ms,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) as p95_ms,
          ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) as p99_ms,
          COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) as active_threshold,
          COUNT(CASE WHEN t.response_time <= COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) THEN 1 END) as satisfied,
          COUNT(CASE WHEN t.response_time > COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AND t.response_time <= (COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) * 4) THEN 1 END) as tolerating
        FROM transactions t
        LEFT JOIN test_runs tr ON tr.test_run_id = t.test_run_id
        LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN workload_apdex_thresholds wat
          ON wat.system_under_test_id = sut.id
          AND wat.test_environment = tr.test_environment
          AND wat.workload = tr.workload
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON wtat.system_under_test_id = sut.id
          AND wtat.test_environment = tr.test_environment
          AND wtat.workload = tr.workload
          AND wtat.transaction_name = t.transaction_name
        WHERE t.test_run_id = $1
          AND ($2::boolean = false OR t.time >= $3::timestamptz)
          ${orgFilter.clause}
        GROUP BY t.transaction_name, t.scenario_name, wtat.apdex_threshold, wat.apdex_threshold
        ORDER BY t.scenario_name, t.transaction_name
      `;

      const allTransactions: ApdexTransactionRow[] = await withRequestEm(this.testRunRepo).query(allTransactionsQuery, queryParams);

      if (!allTransactions || allTransactions.length === 0) {
        return null;
      }

      // Calculate overall metrics using weighted averages (matches Performance Analysis)
      let totalCount = 0;
      let _totalSatisfied = 0;
      let _totalTolerating = 0;
      let totalFailed = 0;
      let weightedAvg = 0;
      let weightedP95 = 0;
      let weightedP99 = 0;
      let weightedApdex = 0;
      const thresholdSet = new Set<number>();

      for (const txn of allTransactions) {
        const count = parseInt(txn.total);
        const txnSatisfied = parseInt(txn.satisfied);
        const txnTolerating = parseInt(txn.tolerating);
        const txnApdex = (txnSatisfied + 0.5 * txnTolerating) / count;

        totalCount += count;
        _totalSatisfied += txnSatisfied;
        _totalTolerating += txnTolerating;
        totalFailed += parseInt(txn.fail);
        weightedAvg += parseFloat(txn.avg_ms) * count;
        weightedP95 += parseFloat(txn.p95_ms) * count;
        weightedP99 += parseFloat(txn.p99_ms) * count;
        weightedApdex += txnApdex * count;
        thresholdSet.add(parseInt(txn.active_threshold) || 500);
      }

      const overallApdex = totalCount > 0 ? weightedApdex / totalCount : 0;
      const overallAvg = totalCount > 0 ? Math.round((weightedAvg / totalCount) * 100) / 100 : 0;
      const overallP95 = totalCount > 0 ? Math.round((weightedP95 / totalCount) * 100) / 100 : 0;
      const overallP99 = totalCount > 0 ? Math.round((weightedP99 / totalCount) * 100) / 100 : 0;
      const overallErrorRate = totalCount > 0 ? (totalFailed / totalCount) * 100 : 0;

      // Fetch peak throughput metrics (transactions/sec and requests/sec) with organization filtering
      const throughputStats = await this.getThroughputStatsForReport(testRunId, excludeRampUp, cutoffTime, userId, roles);

      // Fetch virtual user stats (peak active users) with organization filtering
      const virtualUserStats = await this.getVirtualUserStatsForReport(testRunId, excludeRampUp, cutoffTime, userId, roles);

      // Group transactions by scenario and calculate weighted averages
      const scenarioMap: Record<string, ApdexTransactionRow[]> = {};
      for (const txn of allTransactions) {
        const scenarioName = txn.scenario_name || 'Unknown';
        if (!scenarioMap[scenarioName]) {
          scenarioMap[scenarioName] = [];
        }
        scenarioMap[scenarioName].push(txn);
      }

      const scenarios: Record<string, ApdexScenarioData> = {};

      for (const [scenarioName, scenarioTransactions] of Object.entries(scenarioMap)) {
        // Calculate scenario summary using weighted averages (matches Performance Analysis)
        let scenarioTotal = 0;
        let _scenarioSatisfied = 0;
        let _scenarioTolerating = 0;
        let scenarioFailed = 0;
        let scenarioWeightedAvg = 0;
        let scenarioWeightedP95 = 0;
        let scenarioWeightedP99 = 0;
        let scenarioWeightedApdex = 0;

        const transactions = scenarioTransactions.map((txn: ApdexTransactionRow) => {
          const txnTotal = parseInt(txn.total);
          const txnSatisfied = parseInt(txn.satisfied);
          const txnTolerating = parseInt(txn.tolerating);
          const txnApdex = (txnSatisfied + 0.5 * txnTolerating) / txnTotal;
          const txnErrorPct = txnTotal > 0 ? (parseInt(txn.fail) / txnTotal) * 100 : 0;

          // Accumulate for scenario summary
          scenarioTotal += txnTotal;
          _scenarioSatisfied += txnSatisfied;
          _scenarioTolerating += txnTolerating;
          scenarioFailed += parseInt(txn.fail);
          scenarioWeightedAvg += parseFloat(txn.avg_ms) * txnTotal;
          scenarioWeightedP95 += parseFloat(txn.p95_ms) * txnTotal;
          scenarioWeightedP99 += parseFloat(txn.p99_ms) * txnTotal;
          scenarioWeightedApdex += txnApdex * txnTotal;

          return {
            name: txn.transaction_name,
            avgMs: parseFloat(txn.avg_ms) || 0,
            p95Ms: parseFloat(txn.p95_ms) || 0,
            p99Ms: parseFloat(txn.p99_ms) || 0,
            pass: parseInt(txn.pass) || 0,
            fail: parseInt(txn.fail) || 0,
            errPct: txnErrorPct,
            apdex: txnApdex,
            threshold: parseInt(txn.active_threshold) || 500,
          };
        });

        const scenarioApdex = scenarioTotal > 0 ? scenarioWeightedApdex / scenarioTotal : 0;
        const scenarioAvg = scenarioTotal > 0 ? Math.round((scenarioWeightedAvg / scenarioTotal) * 100) / 100 : 0;
        const scenarioP95 = scenarioTotal > 0 ? Math.round((scenarioWeightedP95 / scenarioTotal) * 100) / 100 : 0;
        const scenarioP99 = scenarioTotal > 0 ? Math.round((scenarioWeightedP99 / scenarioTotal) * 100) / 100 : 0;
        const errorRate = scenarioTotal > 0 ? (scenarioFailed / scenarioTotal) * 100 : 0;

        // Get peak metrics for this scenario
        const scenarioThroughput = throughputStats.by_scenario.find((s) => s.scenario_name === scenarioName);
        const scenarioVirtualUsers = virtualUserStats.by_scenario.find((s) => s.scenario_name === scenarioName);

        scenarios[scenarioName] = {
          scenario: scenarioName,
          summary: {
            peakTxnsPerSec: scenarioThroughput?.peak_transactions_per_second || 0,
            peakReqsPerSec: scenarioThroughput?.peak_requests_per_second || 0,
            peakVu: scenarioVirtualUsers?.peak_active_threads || 0,
            avgVu: scenarioVirtualUsers?.avg_active_threads || 0,
            errors: errorRate,
            avgMs: scenarioAvg,
            p95Ms: scenarioP95,
            p99Ms: scenarioP99,
            apdex: scenarioApdex,
          },
          transactions,
        };
      }

      return {
        overall: {
          peakTxnsPerSec: throughputStats.overall.peak_transactions_per_second,
          peakReqsPerSec: throughputStats.overall.peak_requests_per_second,
          peakActiveUsers: virtualUserStats.overall.peak_active_threads,
          avgActiveUsers: virtualUserStats.overall.avg_active_threads,
          errorRate: overallErrorRate,
          failedCount: totalFailed,
          avgMs: overallAvg,
          p95Ms: overallP95,
          p99Ms: overallP99,
          apdex: overallApdex,
          threshold: thresholdSet.size === 1 ? ([...thresholdSet][0] ?? null) : null,
          thresholdVaries: thresholdSet.size > 1,
        },
        scenarios,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Apdex data from database:`, error);
      return null;
    }
  }

  /**
   * Single round-trip lookup that fetches the (sut, env, start_time, end_time)
   * needed to read the 5 s CAGGs and probes whether either CAGG already covers
   * this run's window. Org-filtered when `orgIds` is non-null.
   *
   * Returns null when the run doesn't exist or the user lacks access — callers
   * fall back to the raw-scan path (which itself returns zeros under those
   * conditions, matching pre-#288 behavior).
   */
  private async loadThroughputRunInfoForReport(
    testRunId: string,
    orgIds: string[] | null,
  ): Promise<{
    sut: string;
    env: string;
    startTime: Date;
    endTime: Date;
    hasCagg: boolean;
  } | null> {
    // Empty list = a user with no accessible orgs, who sees nothing. Matches
    // buildOrganizationFilterClause.
    const orgClause =
      orgIds === null
        ? ''
        : orgIds.length > 0
          ? `AND tr.organization_id IN (${orgIds.map((_, i) => `$${2 + i}`).join(', ')})`
          : 'AND FALSE';

    const query = `
      SELECT
        sut.name           AS sut,
        tr.test_environment AS env,
        tr.start_time      AS start_time,
        tr.end_time        AS end_time,
        (
          EXISTS (
            SELECT 1 FROM transactions_5s c
            WHERE c.system_under_test = sut.name
              AND c.test_environment  = tr.test_environment
              AND c.bucket >= tr.start_time
              AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
          )
          OR EXISTS (
            SELECT 1 FROM requests_raw_5s c
            WHERE c.system_under_test = sut.name
              AND c.test_environment  = tr.test_environment
              AND c.bucket >= tr.start_time
              AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
          )
        ) AS has_cagg
      FROM test_runs tr
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE tr.test_run_id = $1
        ${orgClause}
      LIMIT 1
    `;

    const params: unknown[] = orgIds === null ? [testRunId] : [testRunId, ...orgIds];

    const rows = await withRequestEm(this.testRunRepo).query(query, params);
    if (!rows || rows.length === 0) return null;
    const row = rows[0] as {
      sut: string;
      env: string;
      start_time: string | Date | null;
      end_time: string | Date | null;
      has_cagg: boolean;
    };
    if (!row.start_time || !row.end_time) return null;
    return {
      sut: row.sut,
      env: row.env,
      startTime: new Date(row.start_time),
      endTime: new Date(row.end_time),
      hasCagg: row.has_cagg === true,
    };
  }

  /**
   * CAGG-backed throughput for report generation. Reads from the 5 s continuous
   * aggregates (`transactions_5s`, `requests_raw_5s`) keyed by (sut, env,
   * bucket). Same `CEIL(MAX(SUM(n))/5)` semantics the report has been emitting.
   *
   * Issue #288.
   */
  private async getThroughputStatsFromCaggForReport(
    runInfo: { sut: string; env: string; startTime: Date; endTime: Date },
    excludeRampUp: boolean,
    cutoffTime: Date | null,
  ): Promise<ThroughputStats> {
    const params: unknown[] = [
      runInfo.sut,
      runInfo.env,
      runInfo.startTime,
      runInfo.endTime,
      excludeRampUp,
      cutoffTime,
    ];

    const transactionsQuery = `
      WITH per_bucket AS (
        SELECT c.bucket, SUM(c.n)::bigint AS total
        FROM transactions_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
        GROUP BY c.bucket
      )
      SELECT CEIL(COALESCE(MAX(total), 0)::numeric / 5) AS peak_transactions_per_second
      FROM per_bucket
    `;

    const requestsQuery = `
      WITH per_bucket AS (
        SELECT c.bucket, SUM(c.n)::bigint AS total
        FROM requests_raw_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
        GROUP BY c.bucket
      )
      SELECT CEIL(COALESCE(MAX(total), 0)::numeric / 5) AS peak_requests_per_second
      FROM per_bucket
    `;

    const scenarioQuery = `
      WITH tx_per AS (
        SELECT c.scenario_name, c.bucket, SUM(c.n)::bigint AS total
        FROM transactions_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
          AND c.scenario_name IS NOT NULL
        GROUP BY c.scenario_name, c.bucket
      ),
      req_per AS (
        SELECT c.scenario_name, c.bucket, SUM(c.n)::bigint AS total
        FROM requests_raw_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
          AND c.scenario_name IS NOT NULL
        GROUP BY c.scenario_name, c.bucket
      ),
      tx_peaks AS (
        SELECT scenario_name, CEIL(MAX(total)::numeric / 5) AS peak_transactions_per_second
        FROM tx_per GROUP BY scenario_name
      ),
      req_peaks AS (
        SELECT scenario_name, CEIL(MAX(total)::numeric / 5) AS peak_requests_per_second
        FROM req_per GROUP BY scenario_name
      )
      SELECT
        COALESCE(t.scenario_name, r.scenario_name) AS scenario_name,
        COALESCE(t.peak_transactions_per_second, 0) AS peak_transactions_per_second,
        COALESCE(r.peak_requests_per_second, 0)     AS peak_requests_per_second
      FROM tx_peaks t
      FULL OUTER JOIN req_peaks r ON t.scenario_name = r.scenario_name
      ORDER BY scenario_name ASC
    `;

    const [transactionsResult, requestsResult, scenarioResult] = await Promise.all([
      withRequestEm(this.testRunRepo).query(transactionsQuery, params),
      withRequestEm(this.testRunRepo).query(requestsQuery, params),
      withRequestEm(this.testRunRepo).query(scenarioQuery, params),
    ]);

    const transactions = transactionsResult[0] || { peak_transactions_per_second: 0 };
    const requests = requestsResult[0] || { peak_requests_per_second: 0 };

    return {
      overall: {
        peak_transactions_per_second: parseInt(transactions.peak_transactions_per_second) || 0,
        peak_requests_per_second: parseInt(requests.peak_requests_per_second) || 0,
      },
      by_scenario: (scenarioResult as ThroughputScenarioRow[]).map((row) => ({
        scenario_name: row.scenario_name,
        peak_transactions_per_second: parseInt(row.peak_transactions_per_second) || 0,
        peak_requests_per_second: parseInt(row.peak_requests_per_second) || 0,
      })),
    };
  }

  /**
   * Get throughput stats for report generation
   * Calculates peak transactions/sec and peak requests/sec
   * @param testRunId - Test run ID
   * @param excludeRampUp - Whether to exclude ramp-up period
   * @param cutoffTime - Cutoff time for excluding ramp-up
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Throughput statistics (overall and per-scenario)
   */
  async getThroughputStatsForReport(
    testRunId: string,
    excludeRampUp: boolean = false,
    cutoffTime: Date | null = null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<ThroughputStats> {
    try {
      // Internal/system calls (no userId) or admin users bypass org filtering
      const orgIds = userId ? await withOrgFilter(userId, roles, this.authzService) : null;

      // Single round-trip: SUT/env (the CAGG keying), test-run window, and a probe
      // for whether the 5 s CAGGs already cover this run. When they do, the dashboard
      // queries collapse from ~30-40 s of raw-hypertable scans to a few hundred
      // pre-aggregated rows. See issue #288.
      const runInfo = await this.loadThroughputRunInfoForReport(testRunId, orgIds);
      if (runInfo && runInfo.hasCagg) {
        return await this.getThroughputStatsFromCaggForReport(runInfo, excludeRampUp, cutoffTime);
      }

      // Fallback: in-flight run that pre-dates the next CAGG refresh (≤30 s lag),
      // run not yet started, or a stack where the CAGG policy never ran. Reverts
      // to the legacy raw-scan path.

      // Build organization filter for test_run validation
      // Base params are: [testRunId, excludeRampUp, cutoffTime] = indices 1, 2, 3
      // Organization params start at index 4
      const orgFilter = orgIds !== null
        ? this.buildOrganizationFilterClause(4, orgIds, 'tr')
        : { clause: '', params: [] };

      // Build the org filter CTE clause using tr.organization_id directly
      const orgFilterCte = orgIds !== null
        ? orgIds.length > 0
          ? `, org_filter AS (
              SELECT tr.test_run_id FROM test_runs tr
              WHERE tr.test_run_id = $1
                AND tr.organization_id IN (${orgIds.map((_, i) => `$${4 + i}`).join(', ')})
            )`
          : `, org_filter AS (
              SELECT tr.test_run_id FROM test_runs tr WHERE FALSE
            )`
        : '';

      const orgFilterJoin = orgIds !== null
        ? 'AND EXISTS (SELECT 1 FROM org_filter)'
        : '';

      const transactionsQuery = `
        WITH five_second_buckets AS (
          SELECT
            floor(extract(epoch from time) / 5) * 5 as time_bucket,
            COUNT(*) as total_count
          FROM transactions
          WHERE test_run_id = $1
            AND ($2::boolean = false OR time >= $3::timestamptz)
          GROUP BY floor(extract(epoch from time) / 5)
        )${orgFilterCte}
        SELECT CEIL(MAX(total_count)::numeric / 5) as peak_transactions_per_second
        FROM five_second_buckets
        WHERE 1=1 ${orgFilterJoin}
      `;

      const requestsQuery = `
        WITH five_second_buckets AS (
          SELECT
            floor(extract(epoch from time) / 5) * 5 as time_bucket,
            COUNT(*) as total_count
          FROM requests_raw
          WHERE test_run_id = $1
            AND ($2::boolean = false OR time >= $3::timestamptz)
          GROUP BY floor(extract(epoch from time) / 5)
        )${orgFilterCte}
        SELECT CEIL(MAX(total_count)::numeric / 5) as peak_requests_per_second
        FROM five_second_buckets
        WHERE 1=1 ${orgFilterJoin}
      `;

      const scenarioQuery = `
        WITH transaction_buckets AS (
          SELECT
            scenario_name,
            floor(extract(epoch from time) / 5) as time_bucket,
            COUNT(*) as total_count
          FROM transactions
          WHERE test_run_id = $1
            AND scenario_name IS NOT NULL
            AND ($2::boolean = false OR time >= $3::timestamptz)
          GROUP BY scenario_name, floor(extract(epoch from time) / 5)
        ),
        request_buckets AS (
          SELECT
            scenario_name,
            floor(extract(epoch from time) / 5) as time_bucket,
            COUNT(*) as total_count
          FROM requests_raw
          WHERE test_run_id = $1
            AND scenario_name IS NOT NULL
            AND ($2::boolean = false OR time >= $3::timestamptz)
          GROUP BY scenario_name, floor(extract(epoch from time) / 5)
        ),
        transaction_peaks AS (
          SELECT
            scenario_name,
            CEIL(MAX(total_count)::numeric / 5) as peak_transactions_per_second
          FROM transaction_buckets
          GROUP BY scenario_name
        ),
        request_peaks AS (
          SELECT
            scenario_name,
            CEIL(MAX(total_count)::numeric / 5) as peak_requests_per_second
          FROM request_buckets
          GROUP BY scenario_name
        )${orgFilterCte}
        SELECT
          COALESCE(t.scenario_name, r.scenario_name) as scenario_name,
          COALESCE(t.peak_transactions_per_second, 0) as peak_transactions_per_second,
          COALESCE(r.peak_requests_per_second, 0) as peak_requests_per_second
        FROM transaction_peaks t
        FULL OUTER JOIN request_peaks r ON t.scenario_name = r.scenario_name
        WHERE 1=1 ${orgFilterJoin}
        ORDER BY scenario_name ASC
      `;

      const queryParams = cutoffTime
        ? [testRunId, excludeRampUp, cutoffTime, ...orgFilter.params]
        : [testRunId, excludeRampUp, null, ...orgFilter.params];

      const [transactionsResult, requestsResult, scenarioResult] = await Promise.all([
        withRequestEm(this.testRunRepo).query(transactionsQuery, queryParams),
        withRequestEm(this.testRunRepo).query(requestsQuery, queryParams),
        withRequestEm(this.testRunRepo).query(scenarioQuery, queryParams),
      ]);

      const transactions = transactionsResult[0] || { peak_transactions_per_second: 0 };
      const requests = requestsResult[0] || { peak_requests_per_second: 0 };

      return {
        overall: {
          peak_transactions_per_second: parseInt(transactions.peak_transactions_per_second) || 0,
          peak_requests_per_second: parseInt(requests.peak_requests_per_second) || 0,
        },
        by_scenario: (scenarioResult as ThroughputScenarioRow[]).map((row) => ({
          scenario_name: row.scenario_name,
          peak_transactions_per_second: parseInt(row.peak_transactions_per_second) || 0,
          peak_requests_per_second: parseInt(row.peak_requests_per_second) || 0,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch throughput stats for report:`, error);
      return {
        overall: { peak_transactions_per_second: 0, peak_requests_per_second: 0 },
        by_scenario: [],
      };
    }
  }

  /**
   * Get virtual user stats for report generation
   * Calculates peak and average active threads (users)
   * @param testRunId - Test run ID
   * @param excludeRampUp - Whether to exclude ramp-up period
   * @param cutoffTime - Cutoff time for excluding ramp-up
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Virtual user statistics (overall and per-scenario)
   */
  async getVirtualUserStatsForReport(
    testRunId: string,
    excludeRampUp: boolean = false,
    cutoffTime: Date | null = null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<VirtualUserStats> {
    try {
      // Internal/system calls (no userId) or admin users bypass org filtering
      const orgIds = userId ? await withOrgFilter(userId, roles, this.authzService) : null;

      // Build organization filter for test_run validation
      // Base params are: [testRunId, excludeRampUp, cutoffTime] = indices 1, 2, 3
      // Organization params start at index 4
      const orgFilter = orgIds !== null
        ? this.buildOrganizationFilterClause(4, orgIds, 'tr')
        : { clause: '', params: [] };

      // Build organization filter using tr.organization_id directly
      const orgFilterJoinClause = orgIds !== null
        ? orgIds.length > 0
          ? `AND EXISTS (
              SELECT 1 FROM test_runs tr
              WHERE tr.test_run_id = vu.test_run_id
                AND tr.organization_id IN (${orgIds.map((_, i) => `$${4 + i}`).join(', ')})
            )`
          : 'AND FALSE'
        : '';

      const overallQuery = `
        SELECT
          MAX(vu.active_threads) as peak_active_threads,
          AVG(vu.active_threads)::numeric(10,2) as avg_active_threads
        FROM virtual_users vu
        WHERE vu.test_run_id = $1
          AND ($2::boolean = false OR vu.time >= $3::timestamptz)
          ${orgFilterJoinClause}
      `;

      const scenarioQuery = `
        SELECT
          vu.scenario_name,
          MAX(vu.active_threads) as peak_active_threads,
          AVG(vu.active_threads)::numeric(10,2) as avg_active_threads
        FROM virtual_users vu
        WHERE vu.test_run_id = $1
          AND vu.scenario_name IS NOT NULL
          AND ($2::boolean = false OR vu.time >= $3::timestamptz)
          ${orgFilterJoinClause}
        GROUP BY vu.scenario_name
        ORDER BY vu.scenario_name ASC
      `;

      const queryParams = cutoffTime
        ? [testRunId, excludeRampUp, cutoffTime, ...orgFilter.params]
        : [testRunId, excludeRampUp, null, ...orgFilter.params];

      const [overallResult, scenarioResult] = await Promise.all([
        withRequestEm(this.testRunRepo).query(overallQuery, queryParams),
        withRequestEm(this.testRunRepo).query(scenarioQuery, queryParams),
      ]);

      const overall = overallResult[0] || {};

      return {
        overall: {
          peak_active_threads: parseInt(overall.peak_active_threads) || 0,
          avg_active_threads: parseFloat(overall.avg_active_threads) || 0,
        },
        by_scenario: (scenarioResult as VirtualUserScenarioRow[]).map((row) => ({
          scenario_name: row.scenario_name,
          peak_active_threads: parseInt(row.peak_active_threads) || 0,
          avg_active_threads: parseFloat(row.avg_active_threads) || 0,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch virtual user stats for report:`, error);
      return {
        overall: { peak_active_threads: 0, avg_active_threads: 0 },
        by_scenario: [],
      };
    }
  }

  /**
   * Get mock scenario data matching PDF format
   * Used for preview mode when no test run is available
   *
   * @param scenarioName - Scenario to fetch data for
   * @returns Mock scenario data or null if not found
   */
  getMockScenarioData(scenarioName: string): ScenarioData | null {
    // Mock data structure matching the PDF example
    const mockScenarios: Record<string, ScenarioData> = {
      BrowseAndSearch: {
        scenario: 'BrowseAndSearch',
        summary: {
          peakTxnsPerSec: 6,
          peakReqsPerSec: 7,
          peakVu: 10,
          errors: 0,
          avgMs: 64.5,
          p95Ms: 141.75,
          p99Ms: 158.2,
          apdex: 0.992,
        },
        transactions: [
          {
            name: 'T01_Homepage_Load',
            avgMs: 92.24,
            p95Ms: 160.85,
            p99Ms: 213.62,
            pass: 144,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T02_Browse_Category',
            avgMs: 61.18,
            p95Ms: 127.0,
            p99Ms: 131.17,
            pass: 184,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T03_Search_Products',
            avgMs: 57.13,
            p95Ms: 155.9,
            p99Ms: 184.72,
            pass: 215,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T04_View_Product_Details',
            avgMs: 89.35,
            p95Ms: 188.0,
            p99Ms: 190.0,
            pass: 204,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T05_Apply_Filters',
            avgMs: 22.16,
            p95Ms: 67.05,
            p99Ms: 74.62,
            pass: 120,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T06_Compare_Products',
            avgMs: 78.64,
            p95Ms: 168.0,
            p99Ms: 171.0,
            pass: 117,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T07_Product_Assets',
            avgMs: 35.07,
            p95Ms: 85.2,
            p99Ms: 101.2,
            pass: 117,
            fail: 0,
            errPct: 0.0,
          },
        ],
      },
      Checkout: {
        scenario: 'Checkout',
        summary: {
          peakTxnsPerSec: 6,
          peakReqsPerSec: 9,
          peakVu: 10,
          errors: 0.38,
          avgMs: 84.27,
          p95Ms: 224.58,
          p99Ms: 230.42,
          apdex: 0.985,
        },
        transactions: [
          {
            name: 'T01_Add_To_Cart',
            avgMs: 45.3,
            p95Ms: 109.55,
            p99Ms: 113.82,
            pass: 210,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T02_User_Login',
            avgMs: 55.51,
            p95Ms: 108.0,
            p99Ms: 110.98,
            pass: 203,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T03_Shipping_Address',
            avgMs: 79.72,
            p95Ms: 210.0,
            p99Ms: 217.0,
            pass: 200,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T04_Payment_Processing',
            avgMs: 148.57,
            p95Ms: 509.05,
            p99Ms: 515.61,
            pass: 239,
            fail: 1,
            errPct: 0.42,
          },
          {
            name: 'T05_Order_Confirmation',
            avgMs: 122.88,
            p95Ms: 262.0,
            p99Ms: 266.0,
            pass: 222,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T06_Post_Order_Recommendations',
            avgMs: 51.6,
            p95Ms: 96.0,
            p99Ms: 101.88,
            pass: 107,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'T07_Order_Tracking_Assets',
            avgMs: 43.26,
            p95Ms: 135.75,
            p99Ms: 148.3,
            pass: 132,
            fail: 4,
            errPct: 2.94,
          },
        ],
      },
      all: {
        scenario: 'All Scenarios',
        summary: {
          peakTxnsPerSec: 6,
          peakReqsPerSec: 9,
          peakVu: 10,
          errors: 0.21,
          avgMs: 75.27,
          p95Ms: 186.88,
          p99Ms: 197.55,
          apdex: 0.992,
        },
        transactions: [
          {
            name: 'BrowseAndSearch (7 transactions)',
            avgMs: 64.5,
            p95Ms: 141.75,
            p99Ms: 158.2,
            pass: 1101,
            fail: 0,
            errPct: 0.0,
          },
          {
            name: 'Checkout (7 transactions)',
            avgMs: 84.27,
            p95Ms: 224.58,
            p99Ms: 230.42,
            pass: 1113,
            fail: 5,
            errPct: 0.45,
          },
        ],
      },
    };

    return mockScenarios[scenarioName] || null;
  }

  /**
   * The run immediately before this one in the same system, environment and workload, or null
   * when there is none.
   *
   * "Previous" is relative to the run being reported on, not simply the newest run there is.
   * The two differ whenever a report is generated for an older run — backfilling, or re-running
   * a report after the fact — where the newest run is *later* and comparing against it would
   * read the change backwards.
   *
   * Scope and completed-only match the baseline dropdown in the UI (getBaselineCandidates), so
   * "previous" resolves to the run a person would have picked from the top of that list.
   */
  async getPreviousTestRun(testRun: TestRun): Promise<TestRun | null> {
    return withRequestEm(this.testRunRepo)
      .createQueryBuilder('tr')
      .where('tr.systemUnderTestId = :systemUnderTestId', {
        systemUnderTestId: testRun.systemUnderTestId,
      })
      .andWhere('tr.testEnvironment = :testEnvironment', {
        testEnvironment: testRun.testEnvironment,
      })
      .andWhere('tr.workload = :workload', { workload: testRun.workload })
      .andWhere('tr.completed = :completed', { completed: true })
      .andWhere('tr.id != :id', { id: testRun.id })
      // Strictly earlier: ordering by start time alone would return a LATER run when the
      // report is generated for anything but the newest.
      .andWhere('tr.startTime < :startTime', { startTime: testRun.startTime })
      .orderBy('tr.startTime', 'DESC')
      .limit(1)
      .getOne();
  }


  /**
   * Get AWR data for a test run
   * Fetches AWR reports and their analysis insights
   */
  async getAwrData(testRunId: string): Promise<AwrData | null> {
    try {
      // awr_reports.test_run_id is a uuid foreign key onto test_runs(id) — the ONLY table this
      // service reads that is keyed that way. transactions, requests_raw, ds_metrics, the
      // rollups and the rest are all keyed by the human test run id, which is what every
      // renderer passes and what this method is therefore handed.
      //
      // Sending the human id to a uuid column is a 22P02, and the catch below turns that into a
      // warning, so the AWR section came out empty in every generated report instead of failing
      // loudly. Resolving here rather than at the one call site keeps the renderers uniform:
      // they all pass testRun.testRunId, and none of them has to know which tables are keyed
      // which way.
      const testRunUuid = await resolveTestRunUuid(this.testRunRepo, testRunId);
      if (!testRunUuid) {
        return null;
      }
      const reportRows: Array<{
        id: string;
        db_name: string | null;
        instance_name: string | null;
        db_edition: string | null;
        db_release: string | null;
        host_name: string | null;
        platform: string | null;
        cpus: number | null;
        cores: number | null;
        memory_gb: string | null;
        begin_time: string | null;
        end_time: string | null;
        elapsed_minutes: string | null;
        db_time_minutes: string | null;
        parsed_data: Record<string, unknown> | null;
      }> = await this.dataSource.query(
        `SELECT id, db_name, instance_name, db_edition, db_release,
                host_name, platform, cpus, cores, memory_gb,
                begin_time, end_time, elapsed_minutes, db_time_minutes,
                parsed_data
         FROM awr_reports
         WHERE test_run_id = $1 AND parse_status = 'completed'
         ORDER BY begin_time ASC`,
        [testRunUuid],
      );

      if (reportRows.length === 0) return null;

      const reportIds = reportRows.map((r) => r.id);

      // Fetch analysis insights for all reports
      const analysisRows: Array<{
        insights: Array<{
          severity: string;
          category: string;
          title: string;
          description: string;
          recommendation?: string;
          value?: number;
          unit?: string;
        }> | null;
        severity_summary: { critical: number; warning: number; info: number; total: number } | null;
      }> = await this.dataSource.query(
        `SELECT insights, severity_summary
         FROM awr_analysis
         WHERE awr_report_id = ANY($1)
         ORDER BY analyzed_at DESC`,
        [reportIds],
      );

      const allInsights: AwrInsightSummary[] = [];
      let severitySummary = { critical: 0, warning: 0, info: 0, total: 0 };

      for (const row of analysisRows) {
        if (row.severity_summary) {
          severitySummary = {
            critical: severitySummary.critical + (row.severity_summary.critical || 0),
            warning: severitySummary.warning + (row.severity_summary.warning || 0),
            info: severitySummary.info + (row.severity_summary.info || 0),
            total: severitySummary.total + (row.severity_summary.total || 0),
          };
        }
        if (row.insights) {
          for (const insight of row.insights) {
            allInsights.push({
              severity: insight.severity,
              category: insight.category,
              title: insight.title,
              description: insight.description,
              recommendation: insight.recommendation || null,
              value: insight.value ?? null,
              unit: insight.unit || null,
            });
          }
        }
      }

      const reports: AwrReportSummary[] = reportRows.map((r) => ({
        id: r.id,
        dbName: r.db_name,
        instanceName: r.instance_name,
        dbEdition: r.db_edition,
        dbRelease: r.db_release,
        hostName: r.host_name,
        platform: r.platform,
        cpus: r.cpus,
        cores: r.cores,
        memoryGb: r.memory_gb != null ? Number(r.memory_gb) : null,
        beginTime: r.begin_time,
        endTime: r.end_time,
        elapsedMinutes: r.elapsed_minutes != null ? Number(r.elapsed_minutes) : null,
        dbTimeMinutes: r.db_time_minutes != null ? Number(r.db_time_minutes) : null,
        parsedData: r.parsed_data,
      }));

      return { reports, insights: allInsights, severitySummary };
    } catch (error) {
      this.logger.warn(`Failed to get AWR data for ${testRunId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get detailed SLO check results for a test run.
   * Returns individual check results with requirement/actual value for the SLO renderer.
   */
  /**
   * Returns `null` — not `[]` — when the query fails. An empty array means the run
   * genuinely has no checks, and the renderer draws a green "all clear" card for it.
   * Conflating the two produced a permanently stored report that said everything
   * passed because a transient DB error had been swallowed.
   */
  async getSloCheckResults(
    testRunId: string,
    _userId: string = '',
    _roles: string[] = [],
  ): Promise<SloCheckResult[] | null> {
    try {
      const rows: SloCheckResult[] = await this.dataSource.query(
        `SELECT
          cr.benchmark_id,
          cr.panel_title,
          cr.metric_name,
          cr.metric_unit,
          cr.evaluate_type,
          cr.source,
          -- The real source of a check is the benchmark's, not the check result's: the checker
          -- writes 'grafana' on every row because that is where the data was collected, while
          -- the benchmark knows whether it is a Grafana panel check, a performance-metrics
          -- check or a custom one. This is the same field the SLO card's source chip reads.
          b.source AS benchmark_source,
          cr.dashboard_label,
          cr.match_pattern,
          cr.requirement->>'operator' AS requirement_operator,
          -- Guarded cast: a single row whose requirement value is not numeric used to
          -- throw here and collapse EVERY SLO into the green "no results" card. A
          -- non-numeric value now yields NULL for that one row instead.
          CASE
            WHEN cr.requirement->>'value' ~ '^\\s*-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?\\s*$'
            THEN (cr.requirement->>'value')::numeric
          END AS requirement_value,
          cr.requirement,
          cr.targets,
          cr.message,
          cr.panel_average,
          cr.meets_requirement
        FROM check_results cr
        LEFT JOIN benchmarks b ON b.id::text = cr.benchmark_id
        WHERE cr.test_run_id = $1
        ORDER BY cr.meets_requirement ASC NULLS LAST, cr.evaluate_type, cr.panel_title`,
        [testRunId],
      );

      return rows;
    } catch (error) {
      this.logger.error(`Failed to get SLO check results for ${testRunId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get SLO check result summary for a test run.
   * Queries check_results table and counts passed/failed using the meets_requirement column.
   */
  async getSloSummary(
    testRunId: string,
    _userId: string = '',
    _roles: string[] = [],
  ): Promise<SloSummary> {
    try {
      const rows: { meets_requirement: boolean | null }[] = await this.dataSource.query(
        `SELECT meets_requirement FROM check_results WHERE test_run_id = $1`,
        [testRunId],
      );

      let passed = 0;
      let failed = 0;

      for (const row of rows) {
        if (row.meets_requirement === true) {
          passed++;
        } else {
          failed++;
        }
      }

      return { passed, failed, total: passed + failed };
    } catch (error) {
      this.logger.warn(`Failed to get SLO summary for ${testRunId}: ${(error as Error).message}`);
      return { passed: 0, failed: 0, total: 0 };
    }
  }

  /**
   * Get detailed regression/improvement data for a test run.
   * Queries ds_adapt_conclusion for summary and ds_adapt_results for per-metric details.
   */
  async getRegressionsData(
    testRunId: string,
    _userId: string = '',
    _roles: string[] = [],
  ): Promise<RegressionsData | null> {
    try {
      // Get overall conclusion
      // The control group joins in here rather than in a second round trip: a reader cannot
      // judge "9 regressions" without knowing how many runs ADAPT weighed them against.
      const conclusionRows: {
        conclusion: string;
        regressions: string[] | null;
        improvements: string[] | null;
        control_group_id: string | null;
        n_test_runs: number | null;
        test_runs: string[] | null;
        first_datetime: string | null;
        last_datetime: string | null;
      }[] = await this.dataSource.query(
        `SELECT c.conclusion, c.regressions, c.improvements, c.control_group_id,
                g.n_test_runs, g.test_runs, g.first_datetime, g.last_datetime
         FROM ds_adapt_conclusion c
         LEFT JOIN ds_control_groups g ON g.control_group_id = c.control_group_id
         WHERE c.test_run_id = $1
         LIMIT 1`,
        [testRunId],
      );

      const conclusionRow = conclusionRows[0];
      if (!conclusionRow) return null;

      // Get per-metric ADAPT results with conclusion and statistic data
      const resultRows: AdaptResultRow[] = await this.dataSource.query(
        `SELECT
          dashboard_label,
          panel_title,
          metric_name,
          unit,
          conclusion,
          statistic
        FROM ds_adapt_results
        WHERE test_run_id = $1
        ORDER BY dashboard_label ASC, panel_title ASC, metric_name ASC`,
        [testRunId],
      );

      const metrics: RegressionsMetric[] = resultRows.map((row) => {
        const conclusion = row.conclusion as Record<string, unknown> | null;
        const statistic = row.statistic as Record<string, unknown> | null;
        const conclusionLabel = conclusion && typeof conclusion.label === 'string'
          ? conclusion.label : 'unknown';
        const testValue = statistic?.test != null ? Number(statistic.test) : null;
        const controlValue = statistic?.control != null ? Number(statistic.control) : null;
        const diff = statistic?.diff != null ? Number(statistic.diff) : null;

        return {
          dashboardLabel: row.dashboard_label,
          panelTitle: row.panel_title,
          metricName: row.metric_name,
          unit: row.unit || null,
          conclusionLabel,
          testValue,
          controlValue,
          difference: diff,
          differencePercent: controlValue && controlValue !== 0 && diff != null
            ? (diff / Math.abs(controlValue)) * 100
            : null,
        };
      });

      const regressions = metrics.filter((m) => m.conclusionLabel === 'regression');
      const improvements = metrics.filter((m) => m.conclusionLabel === 'improvement');

      return {
        conclusion: conclusionRow.conclusion,
        regressionCount: conclusionRow.regressions?.length ?? regressions.length,
        improvementCount: conclusionRow.improvements?.length ?? improvements.length,
        totalMetrics: metrics.length,
        regressions,
        improvements,
        // ADAPT writes this label with a space, not an underscore.
        noDifference: metrics.filter((m) => m.conclusionLabel === 'no difference'),
        ...(conclusionRow.control_group_id
          ? {
              controlGroup: {
                id: conclusionRow.control_group_id,
                testRuns: conclusionRow.test_runs ?? [],
                nTestRuns: conclusionRow.n_test_runs ?? conclusionRow.test_runs?.length ?? 0,
                firstDatetime: conclusionRow.first_datetime,
                lastDatetime: conclusionRow.last_datetime,
              },
            }
          : {}),
      };
    } catch (error) {
      this.logger.warn(`Failed to get regressions data for ${testRunId}: ${(error as Error).message}`);
      return null;
    }
  }

  async getAnomalySummary(
    testRunId: string,
    _userId: string = '',
    _roles: string[] = [],
  ): Promise<AnomalySummary> {
    try {
      const rows: { conclusion: string; regressions: string[] | null; improvements: string[] | null }[] =
        await this.dataSource.query(
          `SELECT conclusion, regressions, improvements FROM ds_adapt_conclusion WHERE test_run_id = $1 LIMIT 1`,
          [testRunId],
        );

      const row = rows[0];
      if (!row) return { conclusion: 'no_data', regressionCount: 0, improvementCount: 0 };

      return {
        conclusion: row.conclusion,
        regressionCount: row.regressions?.length ?? 0,
        improvementCount: row.improvements?.length ?? 0,
      };
    } catch (error) {
      this.logger.warn(`Failed to get anomaly summary for ${testRunId}: ${(error as Error).message}`);
      return { conclusion: 'unknown', regressionCount: 0, improvementCount: 0 };
    }
  }

  /**
   * Get trends data: fetch historical test runs with the same system/environment/workload
   * and compute summary metrics for each run so the trends renderer can show progression.
   */
  async getTrendsData(
    testRun: TestRun,
    maxRuns: number = 10,
    userId: string = '',
    roles: string[] = [],
    /**
     * Where the window starts: a test run id, or the CHANGE_POINT_WINDOW sentinel for
     * "everything since ADAPT last saw the system change". Absent falls back to maxRuns.
     */
    oldestTestRunId?: string,
  ): Promise<TrendsData | null> {
    try {
      const safeMaxRuns = Math.max(1, Math.min(Math.floor(maxRuns), 50));
      const orgFilter = await this.resolveOrgFilter(userId, roles, 5, 'tr');
      const floorTime = await this.resolveTrendWindowStart(testRun, oldestTestRunId);
      // Bound as a parameter, not interpolated: the org filter claims $5..$N, so the floor
      // takes the next free index rather than shifting everything after it.
      const floorParamIndex = 5 + orgFilter.params.length;

      // Fetch recent completed runs for the same system/environment/workload
      const query = `
        SELECT
          tr.test_run_id,
          tr.start_time,
          tr.application_release,
          tr.duration,
          tr.consolidated_result,
          tr.annotations,
          COALESCE(txn_stats.avg_ms, 0) as avg_ms,
          COALESCE(txn_stats.p95_ms, 0) as p95_ms,
          COALESCE(txn_stats.p99_ms, 0) as p99_ms,
          COALESCE(txn_stats.error_rate, 0) as error_rate,
          COALESCE(txn_stats.total_transactions, 0) as total_transactions
        FROM test_runs tr
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN LATERAL (
          SELECT
            ROUND(AVG(t.response_time)::numeric, 2) as avg_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) as p95_ms,
            ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) as p99_ms,
            CASE WHEN COUNT(*) > 0
              THEN ROUND((COUNT(CASE WHEN t.success = false THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 2)
              ELSE 0
            END as error_rate,
            COUNT(*)::integer as total_transactions
          FROM transactions t
          WHERE t.test_run_id = tr.test_run_id
        ) txn_stats ON true
        WHERE tr.system_under_test_id = $1
          AND tr.test_environment = $2
          AND tr.workload = $3
          AND tr.completed = true
          AND tr.is_stale = false
          AND tr.start_time <= $4
          ${floorTime ? `AND tr.start_time >= $${floorParamIndex}` : ''}
          ${orgFilter.clause}
        ORDER BY tr.start_time DESC
        LIMIT ${floorTime ? 51 : safeMaxRuns + 1}
      `;

      const rows = await withRequestEm(this.testRunRepo).query(query, [
        testRun.systemUnderTestId,
        testRun.testEnvironment,
        testRun.workload,
        testRun.startTime || new Date(),
        ...orgFilter.params,
        ...(floorTime ? [floorTime] : []),
      ]);

      if (!rows || rows.length === 0) {
        return null;
      }

      const mapRow = (row: Record<string, unknown>): TrendRunSummary => ({
        testRunId: row.test_run_id as string,
        startTime: new Date(row.start_time as string),
        applicationRelease: (row.application_release as string) || null,
        duration: row.duration ? parseInt(row.duration as string) : null,
        avgMs: parseFloat(row.avg_ms as string) || 0,
        p95Ms: parseFloat(row.p95_ms as string) || 0,
        p99Ms: parseFloat(row.p99_ms as string) || 0,
        errorRate: parseFloat(row.error_rate as string) || 0,
        totalTransactions: parseInt(row.total_transactions as string) || 0,
        consolidatedResult: row.consolidated_result ?? null,
        annotations: Array.isArray(row.annotations) ? (row.annotations as string[]) : [],
      });

      // First row is the current (or most recent) run
      const currentRun = mapRow(rows[0]);
      const previousRuns = rows.slice(1).map(mapRow);

      return { currentRun, previousRuns };
    } catch (error) {
      this.logger.error('Failed to fetch trends data:', error);
      return null;
    }
  }

  /**
   * Fetch time-series metric data from ds_metrics for graph rendering.
   */
  async getMetricsTimeSeries(
    testRunId: string,
    panels: MetricsPanelSelector[],
    excludeRampUp: boolean = true,
    userId: string = '',
    roles: string[] = [],
  ): Promise<MetricsTimeSeriesPanel[]> {
    try {
      if (!panels || panels.length === 0) {
        return [];
      }

      // Internal/system calls (no userId) or admin users bypass org filtering
      const orgIds = userId ? await withOrgFilter(userId, roles, this.authzService) : null;

      const results: MetricsTimeSeriesPanel[] = [];

      for (const panel of panels) {
        const conditions: string[] = ['dm.test_run_id = $1'];
        const params: unknown[] = [testRunId];
        let paramIdx = 2;

        if (panel.dashboardLabel) {
          conditions.push(`dm.dashboard_label = $${paramIdx}`);
          params.push(panel.dashboardLabel);
          paramIdx++;
        }
        if (panel.panelTitle) {
          conditions.push(`dm.panel_title = $${paramIdx}`);
          params.push(panel.panelTitle);
          paramIdx++;
        }
        if (panel.metricName) {
          conditions.push(`dm.metric_name = $${paramIdx}`);
          params.push(panel.metricName);
          paramIdx++;
        }
        if (excludeRampUp) {
          conditions.push('(dm.ramp_up IS NULL OR dm.ramp_up = false)');
        }

        // Org filter via test_runs join
        if (orgIds !== null) {
          const orgFilter = this.buildOrganizationFilterClause(paramIdx, orgIds, 'tr');
          if (orgFilter.clause) {
            conditions.push(`EXISTS (SELECT 1 FROM test_runs tr WHERE tr.test_run_id = dm.test_run_id ${orgFilter.clause})`);
            params.push(...orgFilter.params);
          }
        }

        const query = `
          SELECT
            dm.time,
            dm.value,
            dm.metric_name,
            dm.panel_title,
            dm.dashboard_label,
            dm.unit
          FROM ds_metrics dm
          WHERE ${conditions.join(' AND ')}
          ORDER BY dm.time ASC
        `;

        const rows: MetricsTimeSeriesRow[] = await withRequestEm(this.testRunRepo).query(query, params);

        if (rows.length > 0) {
          const firstRow = rows[0]!;
          const panelTitle = panel.panelTitle || firstRow.panel_title || 'Untitled Panel';
          const dashboardLabel = panel.dashboardLabel || firstRow.dashboard_label || '';
          const metricName = panel.metricName || firstRow.metric_name || '';
          const unit = firstRow.unit || '';

          results.push({
            panelTitle,
            dashboardLabel,
            metricName,
            unit,
            dataPoints: rows.map((row) => ({
              time: new Date(row.time),
              value: row.value !== null && row.value !== undefined ? parseFloat(String(row.value)) : null,
            })),
          });
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Failed to fetch metrics time series:', error);
      return [];
    }
  }

  /**
   * Compare a current test run against a baseline run for the given source.
   * Returns paired rows with per-metric diff percentages.
   *
   * Performance-metrics branch: pairs transactions by scenario_name||transaction_name
   * and computes percentDiff for each requested metric key (avg/p95/p99).
   *
   * Grafana/dynatrace branch: pairs ds_metric_statistics rows by
   * dashboard_label/panel_title/metric_name, with optional dashboardMap
   * substitution so a differently named baseline dashboard pairs.
   */
  /**
   * The per-series history behind a trend section: one row per dashboard/panel/series,
   * carrying that series' value in each of the given runs.
   *
   * Reads the same `ds_metric_statistics` rollups the comparison section pairs against, so a
   * trend and a comparison of the same series never disagree. Selections scope it the same way
   * (no panel = the whole dashboard, no series = the whole panel); an empty selection returns
   * nothing rather than every series ever recorded — a trend section with nothing picked has
   * nothing to draw.
   */
  /**
   * Per-URL history for the virtual URL panels — the trends twin of getUrlComparison, reading
   * the same sampler rollup so a trend and a comparison of one URL cannot disagree.
   */
  private async getUrlTrends(
    testRunIds: string[],
    selections: BaselineComparisonSelection[],
    stat: 'avg' | 'p95' | 'p99',
  ): Promise<MetricTrendSeries[]> {
    const urlSelections = selections.filter((s) => isUrlPanel(s.panelId));
    if (urlSelections.length === 0) return [];

    // No org clause here: the run ids arrive from getTrendsData's own org-filtered window,
    // and the request EM applies RLS on top. Adding one would filter an already-filtered set.
    const rows: Array<Record<string, string | null>> = await withRequestEm(this.testRunRepo).query(
      `WITH agg AS (
         SELECT s.test_run_id, s.url_hash, s.system_under_test, s.test_environment,
                rollup(s.pct_agg) AS pct_agg,
                SUM(s.total_count) AS total_count,
                SUM(s.failed_count) AS failed_count,
                SUM(s.avg_response_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_response_time,
                SUM(s.avg_latency      * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_latency,
                SUM(s.avg_connect_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_connect_time
         FROM test_run_sampler_stats s
         WHERE s.test_run_id = ANY($1::text[]) AND s.ramp_up_excluded = true AND s.total_count > 0
         GROUP BY s.test_run_id, s.url_hash, s.system_under_test, s.test_environment
       )
       SELECT a.test_run_id,
              COALESCE(up.normalized_url, a.url_hash) AS normalized_url,
              ROUND(a.avg_response_time::numeric, 2) AS avg_response_time,
              ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95,
              ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99,
              ROUND(a.avg_latency::numeric, 2) AS avg_latency,
              ROUND(a.avg_connect_time::numeric, 2) AS avg_connect_time,
              ROUND(a.failed_count::numeric / NULLIF(a.total_count, 0) * 100, 2) AS error_percentage,
              ROUND(a.total_count::numeric / NULLIF(GREATEST(tr.duration - COALESCE(tr.ramp_up, 0), 0), 0), 2) AS throughput
       FROM agg a
       JOIN test_runs tr ON tr.test_run_id = a.test_run_id
       LEFT JOIN url_patterns up
         ON up.url_hash = a.url_hash
        AND up.system_under_test = a.system_under_test
        AND up.test_environment = a.test_environment`,
      [testRunIds],
    );
    if (rows.length === 0) return [];

    const num = (v: string | null | undefined) => (v == null ? null : Number(v));
    const out: MetricTrendSeries[] = [];
    for (const sel of urlSelections) {
      const spec = getUrlPanel(sel.panelId!);
      if (!spec) continue;
      const scalarColumn = spec.metric === 'error_percentage' ? 'error_percentage'
        : spec.metric === 'throughput' ? 'throughput'
        : spec.metric === 'latency' ? 'avg_latency'
        : 'avg_connect_time';
      const byUrl = new Map<string, MetricTrendSeries>();
      for (const r of rows) {
        const url = r.normalized_url as string;
        if (sel.metricNames?.length && !sel.metricNames.includes(url)) continue;
        const series = byUrl.get(url) ?? {
          dashboardLabel: sel.dashboardLabel,
          panelTitle: spec.title,
          metricName: url,
          unit: spec.metric === 'error_percentage' ? 'percent' : spec.metric === 'throughput' ? 'reqps' : 'ms',
          valuesByRun: {},
        };
        series.valuesByRun[r.test_run_id as string] = spec.hasPercentiles
          ? num(stat === 'p95' ? r.p95 : stat === 'p99' ? r.p99 : r.avg_response_time)
          : num(r[scalarColumn]);
        byUrl.set(url, series);
      }
      out.push(...byUrl.values());
    }
    return out;
  }

  /** Run-wide aggregate history for a panel whose series list carries the sentinel. */
  private async getAggregatedTrends(
    testRunIds: string[],
    selections: BaselineComparisonSelection[],
    stat: 'avg' | 'p95' | 'p99',
  ): Promise<MetricTrendSeries[]> {
    const wanted = selections.filter(
      (s) => s.metricNames?.includes(ALL_AGGREGATED_SERIES) && aggregatedKindFor(s.panelId),
    );
    if (wanted.length === 0) return [];

    const pct = stat === 'p99' ? 0.99 : 0.95;
    const byKind = new Map<string, Map<string, number | null>>();
    for (const kind of new Set(wanted.map((s) => aggregatedKindFor(s.panelId)!))) {
      const rows: Array<Record<string, string | null>> = kind === 'transaction'
        ? await withRequestEm(this.testRunRepo).query(
            `SELECT t.test_run_id,
                    ROUND(AVG(t.response_time)::numeric, 2) AS avg,
                    ROUND(PERCENTILE_CONT($2) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) AS pct
             FROM transactions t
             WHERE t.test_run_id = ANY($1::text[])
             GROUP BY t.test_run_id`,
            [testRunIds, pct])
        : await withRequestEm(this.testRunRepo).query(
            `WITH agg AS (
               SELECT s.test_run_id, rollup(s.pct_agg) AS pct_agg,
                      SUM(s.avg_response_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg
               FROM test_run_sampler_stats s
               WHERE s.test_run_id = ANY($1::text[]) AND s.ramp_up_excluded = true AND s.total_count > 0
               GROUP BY s.test_run_id
             )
             SELECT a.test_run_id, ROUND(a.avg::numeric, 2) AS avg,
                    ROUND(approx_percentile($2, a.pct_agg)::numeric, 2) AS pct
             FROM agg a`,
            [testRunIds, pct]);
      const values = new Map<string, number | null>();
      for (const r of rows) {
        const v = stat === 'avg' ? r.avg : r.pct;
        values.set(r.test_run_id as string, v == null ? null : Number(v));
      }
      byKind.set(kind, values);
    }

    return wanted.map((sel) => ({
      dashboardLabel: sel.dashboardLabel,
      panelTitle: perfPanelTitle(sel.panelId ?? null, ''),
      metricName: ALL_AGGREGATED_SERIES,
      unit: 'ms',
      valuesByRun: Object.fromEntries(byKind.get(aggregatedKindFor(sel.panelId)!) ?? []),
    }));
  }

  async getMetricTrends(
    testRunIds: string[],
    selections: BaselineComparisonSelection[],
    stat: 'avg' | 'p95' | 'p99' = 'avg',
  ): Promise<MetricTrendSeries[]> {
    if (testRunIds.length === 0 || selections.length === 0) return [];
    try {
      const labels = [...new Set(selections.map((s) => s.dashboardLabel))];
      const rows: Array<{
        test_run_id: string;
        dashboard_label: string | null;
        panel_title: string | null;
        panel_id: number | null;
        metric_name: string | null;
        unit: string | null;
        source_type: string | null;
        mean: number | null;
        q95: number | null;
        q99: number | null;
      }> = await this.dataSource.query(
        `SELECT s.test_run_id, s.dashboard_label, s.panel_title, s.panel_id, s.metric_name, s.unit,
                ms.source_type, s.mean, s.q95, s.q99
         FROM ds_metric_statistics s
         LEFT JOIN metrics_sources ms ON ms.id = s.metrics_source_id
         WHERE s.test_run_id = ANY($1) AND s.dashboard_label = ANY($2)`,
        [testRunIds, labels],
      );

      const field = stat === 'p95' ? 'q95' : stat === 'p99' ? 'q99' : 'mean';
      const selected = (r: typeof rows[number]) =>
        selections.some(
          (sel) =>
            sel.dashboardLabel === r.dashboard_label &&
            (sel.panelId == null || sel.panelId === r.panel_id) &&
            (!sel.metricNames?.length || (r.metric_name != null && sel.metricNames.includes(r.metric_name))),
        );

      const byIdentity = new Map<string, MetricTrendSeries>();
      for (const r of rows.filter(selected)) {
        // Perf-test panels name the statistic in their stored title; the report names the
        // panel once, exactly as the comparison section does. Gated on the source: panel ids
        // are not unique across sources, so a Grafana panel 101 must keep its own title.
        const panelTitle = r.source_type === 'performance_test'
          ? perfPanelTitle(r.panel_id, r.panel_title)
          : (r.panel_title ?? '');
        const key = `${r.dashboard_label}||${panelTitle}||${r.metric_name}`;
        let series = byIdentity.get(key);
        if (!series) {
          series = {
            dashboardLabel: r.dashboard_label ?? 'Other',
            panelTitle,
            metricName: r.metric_name ?? '',
            unit: r.unit,
            valuesByRun: {},
          };
          byIdentity.set(key, series);
        }
        series.valuesByRun[r.test_run_id] = r[field];
      }

      for (const extra of [
        ...(await this.getUrlTrends(testRunIds, selections, stat)),
        ...(await this.getAggregatedTrends(testRunIds, selections, stat)),
      ]) {
        byIdentity.set(`${extra.dashboardLabel}||${extra.panelTitle}||${extra.metricName}`, extra);
      }

      return [...byIdentity.values()].sort(
        (a, b) =>
          a.dashboardLabel.localeCompare(b.dashboardLabel) ||
          a.panelTitle.localeCompare(b.panelTitle) ||
          a.metricName.localeCompare(b.metricName),
      );
    } catch (error) {
      this.logger.warn(`Failed to get metric trends: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Compare the per-URL sampler rollup between two runs.
   *
   * The "URL …" panels a performance-test dashboard offers are virtual: nothing writes them
   * to ds_metric_statistics, so the statistics path returns nothing for them. Their numbers
   * live in `test_run_sampler_stats`, rolled up per normalized URL — the same rollup the
   * compare card's URL dimension reads, so the report and the card cannot disagree.
   *
   * Only URL RT has a distribution; a rate, a throughput or a connect time is one number per
   * URL, so the percentile columns stay empty rather than repeating the average four times.
   */
  private async getUrlComparison(
    currentRunId: string,
    baselineRunId: string,
    selections: BaselineComparisonSelection[],
    opts: { metrics: ('avg' | 'p90' | 'p95' | 'p99')[]; userId: string; roles: string[] },
  ): Promise<BaselineComparisonRow[]> {
    const urlSelections = selections.filter((s) => isUrlPanel(s.panelId));
    if (urlSelections.length === 0) return [];

    const orgFilter = await this.resolveOrgFilter(opts.userId, opts.roles, 2, 'tr');
    const rows: Array<{
      test_run_id: string;
      normalized_url: string;
      avg_response_time: string | null;
      p90: string | null;
      p95: string | null;
      p99: string | null;
      avg_latency: string | null;
      avg_connect_time: string | null;
      error_percentage: string | null;
      throughput: string | null;
    }> = await withRequestEm(this.testRunRepo).query(
      `WITH agg AS (
         SELECT s.test_run_id, s.url_hash, s.system_under_test, s.test_environment,
                rollup(s.pct_agg) AS pct_agg,
                SUM(s.total_count) AS total_count,
                SUM(s.failed_count) AS failed_count,
                SUM(s.avg_response_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_response_time,
                SUM(s.avg_latency      * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_latency,
                SUM(s.avg_connect_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_connect_time
         FROM test_run_sampler_stats s
         JOIN test_runs tr ON tr.test_run_id = s.test_run_id
         WHERE s.test_run_id = ANY($1::text[])
           AND s.ramp_up_excluded = true
           AND s.total_count > 0
           ${orgFilter.clause}
         GROUP BY s.test_run_id, s.url_hash, s.system_under_test, s.test_environment
       )
       SELECT a.test_run_id,
              COALESCE(up.normalized_url, a.url_hash) AS normalized_url,
              ROUND(a.avg_response_time::numeric, 2) AS avg_response_time,
              ROUND(approx_percentile(0.90, a.pct_agg)::numeric, 2) AS p90,
              ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95,
              ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99,
              ROUND(a.avg_latency::numeric, 2) AS avg_latency,
              ROUND(a.avg_connect_time::numeric, 2) AS avg_connect_time,
              ROUND(a.failed_count::numeric / NULLIF(a.total_count, 0) * 100, 2) AS error_percentage,
              ROUND(a.total_count::numeric / NULLIF(GREATEST(tr.duration - COALESCE(tr.ramp_up, 0), 0), 0), 2) AS throughput
       FROM agg a
       JOIN test_runs tr ON tr.test_run_id = a.test_run_id
       LEFT JOIN url_patterns up
         ON up.url_hash = a.url_hash
        AND up.system_under_test = a.system_under_test
        AND up.test_environment = a.test_environment
       ORDER BY a.total_count DESC`,
      [[currentRunId, baselineRunId], ...orgFilter.params],
    );
    if (rows.length === 0) return [];

    const num = (v: unknown) => (v == null ? null : Number(v));
    const byRun = (id: string) => new Map(rows.filter((r) => r.test_run_id === id).map((r) => [r.normalized_url, r]));
    const current = byRun(currentRunId);
    const baseline = byRun(baselineRunId);

    const out: BaselineComparisonRow[] = [];
    for (const sel of urlSelections) {
      const spec = getUrlPanel(sel.panelId!);
      if (!spec) continue;
      const scalarColumn = spec.metric === 'error_percentage' ? 'error_percentage'
        : spec.metric === 'throughput' ? 'throughput'
        : spec.metric === 'latency' ? 'avg_latency'
        : 'avg_connect_time';

      const urls = [...current.keys()].filter((u) => !sel.metricNames?.length || sel.metricNames.includes(u));
      for (const url of urls) {
        const c = current.get(url)!;
        const b = baseline.get(url);
        const pick = (row: typeof c | undefined, key: 'avg' | 'p90' | 'p95' | 'p99'): number | null => {
          if (!row) return null;
          if (!spec.hasPercentiles) return key === 'avg' ? num(row[scalarColumn]) : null;
          return key === 'avg' ? num(row.avg_response_time) : num(row[key]);
        };
        out.push({
          group: `${sel.dashboardLabel} / ${spec.title}`,
          dashboardLabel: sel.dashboardLabel,
          panelTitle: spec.title,
          label: url,
          metrics: opts.metrics.map((k) => {
            const cv = pick(c, k);
            const bv = pick(b, k);
            return { key: k, current: cv, baseline: bv, diffPercent: percentDiff(cv, bv) };
          }),
        });
      }
    }
    return out;
  }

  async getBaselineRunComparison(
    currentRunId: string,
    baselineRunId: string,
    source: 'performance-metrics' | 'grafana' | 'dynatrace',
    opts: {
      metrics: ('avg' | 'p90' | 'p95' | 'p99')[];
      userId: string;
      roles: string[];
      // grafana/dynatrace only: restrict the comparison to a set of dashboard /
      // panel / series selections. Empty means "everything this run recorded".
      selections?: BaselineComparisonSelection[];
      // grafana/dynatrace only: pair a current-run dashboard with a differently
      // named baseline-run dashboard (e.g. per-environment dashboard names)
      dashboardMap?: { current: string; baseline: string }[];
    },
  ): Promise<BaselineComparisonData | null> {
    // Performance-test metrics are stored in the same rollups as every other source, under
    // their own artificial dashboards — so a section that picked dashboards/panels/series
    // compares them the same way. Without a selection the run-wide transaction comparison
    // below stays, which is what an unconfigured section has always rendered.
    if (source === 'performance-metrics' && (opts.selections?.length ?? 0) > 0) {
      const selections = opts.selections ?? [];
      // "All aggregated" is a series the run has no row for — it is the whole run rolled up.
      const aggregatedRows = await this.getAggregatedSeriesRows(currentRunId, baselineRunId, selections, opts);
      // The URL panels are virtual — they need the sampler rollup, not the statistics.
      const urlRows = await this.getUrlComparison(currentRunId, baselineRunId, selections, opts);
      const statSelections = selections
        .filter((s) => !isUrlPanel(s.panelId))
        // A panel that asked ONLY for the aggregate has no per-series query left to run.
        .map((s) => (s.metricNames?.includes(ALL_AGGREGATED_SERIES)
          ? { ...s, metricNames: s.metricNames.filter((m) => m !== ALL_AGGREGATED_SERIES) }
          : s))
        .filter((s) => !(s.metricNames && s.metricNames.length === 0));
      const stats = statSelections.length
        ? await this.getBaselineRunComparisonFromStatistics(
            currentRunId, baselineRunId, source, { ...opts, selections: statSelections })
        : null;
      const rows = [...aggregatedRows, ...(stats?.rows ?? []), ...urlRows];
      return rows.length ? { source, rows } : null;
    }
    if (source === 'performance-metrics') {
      // Query the transactions table directly (like getScenarioDataFromDatabase)
      // instead of the controller-facing TestRunsService facade. The facade treats
      // an empty userId as a non-admin user with zero orgs and returns [] — but
      // report HTML generation runs in a background job with no user context.
      // resolveOrgFilter implements the fetcher's convention: empty userId =
      // system call = no org filter; real users get org-scoped results.
      const orgFilter = await this.resolveOrgFilter(opts.userId, opts.roles, 2, 'tr');
      // ponytail: full-run stats on both sides (consistent diff); apply
      // getRampUpCutoffTime per run if analysis-window comparison is needed.
      const query = `
        SELECT
          txn.test_run_id,
          txn.scenario_name,
          txn.transaction_name,
          ROUND(AVG(txn.response_time)::numeric, 2) as avg_ms,
          ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY txn.response_time)::numeric, 2) as p90_ms,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY txn.response_time)::numeric, 2) as p95_ms,
          ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY txn.response_time)::numeric, 2) as p99_ms
        FROM transactions txn
        JOIN test_runs tr ON tr.test_run_id = txn.test_run_id
        WHERE txn.test_run_id = ANY($1)
        ${orgFilter.clause}
        GROUP BY txn.test_run_id, txn.scenario_name, txn.transaction_name
        ORDER BY txn.scenario_name, txn.transaction_name
      `;
      const allRows: Array<{
        test_run_id: string;
        scenario_name: string | null;
        transaction_name: string;
        avg_ms: string | null;
        p90_ms: string | null;
        p95_ms: string | null;
        p99_ms: string | null;
      }> = await withRequestEm(this.testRunRepo).query(query, [[currentRunId, baselineRunId], ...orgFilter.params]);
      if (allRows.length === 0) return null;

      const key = (r: { scenario_name?: string | null; transaction_name: string }) =>
        `${r.scenario_name ?? ''}||${r.transaction_name}`;
      const cur = allRows.filter((r) => r.test_run_id === currentRunId);
      const baseMap = new Map(allRows.filter((r) => r.test_run_id === baselineRunId).map((r) => [key(r), r]));
      const num = (v: unknown) => (v == null ? null : Number(v));
      const fieldByKey = { avg: 'avg_ms', p90: 'p90_ms', p95: 'p95_ms', p99: 'p99_ms' } as const;
      const rows: BaselineComparisonRow[] = cur.map((c) => {
        const b = baseMap.get(key(c));
        return {
          group: c.scenario_name ?? 'default',
          label: c.transaction_name,
          metrics: opts.metrics.map((k) => {
            const cv = num(c[fieldByKey[k]]);
            const bv = b != null ? num(b[fieldByKey[k]]) : null;
            return { key: k, current: cv, baseline: bv, diffPercent: percentDiff(cv, bv) };
          }),
        };
      });
      return { source, rows };
    }
    // grafana / dynatrace: source is narrowed to 'grafana' | 'dynatrace' here
    return this.getBaselineRunComparisonFromStatistics(currentRunId, baselineRunId, source, opts);
  }

  /**
   * Fetch ds_metric_statistics rows for both runs and pair them by series identity.
   * Grafana: groups by `dashboard_label / panel_title`.
   * Dynatrace: groups by the dt.entity id prefix of the series name.
   * When a dashboardMap is provided, the current row's dashboard_label is
   * substituted with the mapped baseline label before the lookup, so a
   * differently named baseline dashboard pairs (both sources).
   */
  private async getBaselineRunComparisonFromStatistics(
    currentRunId: string,
    baselineRunId: string,
    source: 'grafana' | 'dynatrace' | 'performance-metrics',
    opts: {
      metrics: ('avg' | 'p90' | 'p95' | 'p99')[];
      selections?: BaselineComparisonSelection[];
      dashboardMap?: { current: string; baseline: string }[];
      userId?: string;
      roles?: string[];
    },
  ): Promise<BaselineComparisonData | null> {
    const sourceType =
      source === 'grafana' ? 'grafana' : source === 'dynatrace' ? 'dynatrace' : 'performance_test';
    // Optional scoping (from the section config's dashboard/panel/series selection).
    // Absent -> unfiltered, preserving behavior for configs saved before selection existed.
    // The mapped baseline labels must be included or their rows never reach the pairing.
    const selections = opts.selections ?? [];
    const params: unknown[] = [[currentRunId, baselineRunId], sourceType];
    let scopeFilter = '';
    if (selections.length > 0) {
      const labels = new Set<string>();
      for (const sel of selections) {
        labels.add(sel.dashboardLabel);
        const mapped = opts.dashboardMap?.find((m) => m.current === sel.dashboardLabel)?.baseline;
        if (mapped) labels.add(mapped);
      }
      params.push([...labels]);
      scopeFilter += ` AND s.dashboard_label = ANY($${params.length})`;
    }
    const rows: Array<{
      test_run_id: string;
      dashboard_label: string | null;
      panel_title: string | null;
      panel_id: number | null;
      metric_name: string | null;
      unit: string | null;
      mean: number | null;
      q90: number | null;
      q95: number | null;
      q99: number | null;
    }> = await this.dataSource.query(
      `SELECT s.test_run_id, s.dashboard_label, s.panel_title, s.panel_id, s.metric_name, s.unit, s.mean, s.q90, s.q95, s.q99
       FROM ds_metric_statistics s
       LEFT JOIN metrics_sources ms ON ms.id = s.metrics_source_id
       WHERE s.test_run_id = ANY($1) AND (s.metrics_source_id IS NULL OR ms.source_type = $2)${scopeFilter}`,
      params,
    );
    if (rows.length === 0) return null;

    const identity = (r: typeof rows[number]) =>
      `${r.dashboard_label}||${r.panel_title}||${r.metric_name}`;

    // The selection applies to the CURRENT run only — the mapped baseline
    // dashboard may use different panel ids; pairing is by panel title.
    // A selection with no panelId means "every panel on that dashboard", and a
    // panel with no metricNames means "every series in that panel".
    const selected = (r: typeof rows[number]) =>
      selections.length === 0 ||
      selections.some(
        (sel) =>
          sel.dashboardLabel === r.dashboard_label &&
          (sel.panelId == null || sel.panelId === r.panel_id) &&
          (!sel.metricNames?.length || (r.metric_name != null && sel.metricNames.includes(r.metric_name))),
      );
    const cur = rows.filter((r) => r.test_run_id === currentRunId).filter(selected);
    const baseByIdentity = new Map(
      rows.filter((r) => r.test_run_id === baselineRunId).map((r) => [identity(r), r]),
    );

    // Substitute the current dashboard label with its mapped baseline label
    // before the lookup, so differently named baseline dashboards pair.
    const remapIdentity = (r: typeof rows[number]) => {
      const mapped = opts.dashboardMap?.find((m) => m.current === r.dashboard_label)?.baseline;
      if (!mapped) return identity(r);
      return `${mapped}||${r.panel_title}||${r.metric_name}`;
    };

    const fieldByKey = { avg: 'mean', p90: 'q90', p95: 'q95', p99: 'q99' } as const;

    // Request rows are named `transaction_name.sampler_name`, which says nothing about what was
    // called — the compare card shows the URL underneath, so the report does too.
    const urlByMetricName = source === 'performance-metrics' && cur.some((r) => isRequestPanel(r.panel_id))
      ? await this.getSamplerUrlMap(currentRunId, opts.userId ?? '', opts.roles ?? [])
      : {};

    const rowsOut: BaselineComparisonRow[] = cur.map((c) => {
      const b = baseByIdentity.get(remapIdentity(c));
      const host = source === 'dynatrace' ? this.extractHost(c.metric_name) : null;
      const panelTitle = source === 'performance-metrics'
        ? perfPanelTitle(c.panel_id, c.panel_title)
        : (c.panel_title ?? '');
      return {
        group:
          source === 'dynatrace'
            ? (host ?? 'Hosts')
            : `${c.dashboard_label ?? 'Other'} / ${panelTitle}`.trim(),
        label: c.metric_name ?? '',
        dashboardLabel: c.dashboard_label ?? 'Other',
        panelTitle,
        ...(c.metric_name && urlByMetricName[c.metric_name] ? { url: urlByMetricName[c.metric_name] } : {}),
        metrics: opts.metrics.map((k) => {
          const cv = c[fieldByKey[k]];
          const bv = b ? b[fieldByKey[k]] : null;
          return { key: k, current: cv, baseline: bv, diffPercent: percentDiff(cv, bv) };
        }),
      };
    });

    return { source, rows: rowsOut };
  }

  /**
   * Map of `transaction_name.sampler_name` -> normalized URL for a run, matching
   * ds_metric_statistics.metric_name on the Request RT panels. Mirrors
   * TestRunsPerformanceQueryService.getSamplerUrlMap, but org-scoped through
   * resolveOrgFilter — report generation runs with no user context, and the
   * facade would return {} for an empty userId.
   * Requests with no url_patterns row are omitted; the label then stands alone.
   *
   * `testRunId` must be the human `test_run_id` — test_run_sampler_stats keys on it, so a
   * row UUID matches nothing and returns an empty map (no URLs, no error). Every caller
   * reaches here from `testRun.testRunId`.
   */
  private async getSamplerUrlMap(
    testRunId: string,
    userId: string,
    roles: string[],
  ): Promise<Record<string, string>> {
    try {
      const orgFilter = await this.resolveOrgFilter(userId, roles, 2, 'tr');
      const rows: Array<{ metric_name: string; normalized_url: string }> = await withRequestEm(this.testRunRepo).query(
        `SELECT DISTINCT ON (s.transaction_name || '.' || s.sampler_name)
           s.transaction_name || '.' || s.sampler_name AS metric_name,
           LOWER(up.normalized_url) AS normalized_url
         FROM test_run_sampler_stats s
         JOIN test_runs tr ON tr.test_run_id = s.test_run_id
         JOIN url_patterns up
           ON  up.url_hash          = s.url_hash
           AND up.system_under_test = s.system_under_test
           AND up.test_environment  = s.test_environment
         WHERE s.test_run_id = $1
           AND s.ramp_up_excluded = true
           AND s.total_count > 0
           ${orgFilter.clause}
         ORDER BY s.transaction_name || '.' || s.sampler_name, s.total_count DESC`,
        [testRunId, ...orgFilter.params],
      );
      const map: Record<string, string> = {};
      for (const r of rows) if (r.metric_name && r.normalized_url) map[r.metric_name] = r.normalized_url;
      return map;
    } catch (error) {
      // A missing URL is cosmetic — the comparison itself is still worth rendering.
      this.logger.warn('Failed to load sampler URL map for comparison rows:', error);
      return {};
    }
  }

  /**
   * Extract the host/entity grouping token from a Dynatrace series name.
   * The worker (DataProcessor) stores series as `{dimension values}_{metric}`,
   * where dimension values are dt.entity.* IDs (e.g. HOST-0A1B2C3D4E5F6789)
   * joined by underscores — so the entity id is a leading prefix.
   * ponytail: falls back to the full series name when no entity-id prefix
   * is present (DQL groupings by non-entity dimensions).
   */
  private extractHost(metricName: string | null): string | null {
    if (!metricName) return null;
    const m = metricName.match(/^([A-Z][A-Z_]*-[A-F0-9]{8,})/);
    return m ? m[1]! : metricName;
  }

  /**
   * Auto-discover available panels for a test run from ds_metrics.
   * Used when no explicit panel selection is provided.
   */
  async getAvailableMetricsPanels(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<MetricsPanelSelector[]> {
    try {
      // Internal/system calls (no userId) or admin users bypass org filtering
      const orgIds = userId ? await withOrgFilter(userId, roles, this.authzService) : null;
      let orgClause = '';
      const params: unknown[] = [testRunId];

      if (orgIds !== null) {
        const orgFilter = this.buildOrganizationFilterClause(2, orgIds, 'tr');
        if (orgFilter.clause) {
          orgClause = `AND EXISTS (SELECT 1 FROM test_runs tr WHERE tr.test_run_id = dm.test_run_id ${orgFilter.clause})`;
          params.push(...orgFilter.params);
        }
      }

      const query = `
        SELECT DISTINCT
          dm.dashboard_label,
          dm.panel_title,
          dm.metric_name
        FROM ds_metrics dm
        WHERE dm.test_run_id = $1
          ${orgClause}
        ORDER BY dm.dashboard_label ASC, dm.panel_title ASC, dm.metric_name ASC
        LIMIT 20
      `;

      const rows: Array<{ dashboard_label: string; panel_title: string; metric_name: string }> =
        await withRequestEm(this.testRunRepo).query(query, params);

      return rows.map((row) => ({
        dashboardLabel: row.dashboard_label || '',
        panelTitle: row.panel_title || '',
        metricName: row.metric_name || '',
      }));
    } catch (error) {
      this.logger.error('Failed to discover metrics panels:', error);
      return [];
    }
  }
}
