import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { AuthorizationService } from '../../../common/services/authorization.service';

/** SLO check result summary for header renderer */
export interface SloSummary {
  passed: number;
  failed: number;
  total: number;
}

/** Individual SLO check result for the SLO renderer */
export interface SloCheckResult {
  benchmark_id: string;
  panel_title: string | null;
  metric_name: string | null;
  metric_unit: string | null;
  evaluate_type: string;
  source: string;
  dashboard_label: string | null;
  requirement_operator: string | null;
  requirement_value: number | null;
  panel_average: number | null;
  meets_requirement: boolean | null;
}

/** Anomaly detection summary for header renderer */
export interface AnomalySummary {
  conclusion: string;
  regressionCount: number;
  improvementCount: number;
}

/** Transaction summary for report rendering */
export interface ReportTransaction {
  name: string;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  pass: number;
  fail: number;
  errPct: number;
}

/** Transaction with Apdex score for apdex rendering */
export interface ApdexTransaction extends ReportTransaction {
  apdex: number;
  threshold: number;
}

/** Scenario data with transactions and optional time series */
export interface ScenarioData {
  scenario: string;
  transactions: ReportTransaction[];
  timeSeries?: Record<string, unknown>[];
  summary?: {
    peakTxnsPerSec: number;
    peakReqsPerSec: number;
    peakVu: number;
    avgVu?: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    apdex: number;
  };
}

/** Apdex scenario data with summary and apdex transactions */
export interface ApdexScenarioData {
  scenario: string;
  summary: {
    peakTxnsPerSec: number;
    peakReqsPerSec: number;
    peakVu: number;
    avgVu?: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    apdex: number;
  };
  transactions: ApdexTransaction[];
}

/** Overall Apdex metrics */
export interface ApdexOverallData {
  peakTxnsPerSec: number;
  peakReqsPerSec: number;
  peakActiveUsers: number;
  avgActiveUsers: number;
  errorRate: number;
  failedCount: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  apdex: number;
  threshold: number | null;
  thresholdVaries: boolean;
}

/** Full Apdex data returned by getApdexDataFromDatabase */
export interface ApdexData {
  overall: ApdexOverallData;
  scenarios: Record<string, ApdexScenarioData>;
}

/** Throughput statistics (overall and per-scenario) */
export interface ThroughputStats {
  overall: {
    peak_transactions_per_second: number;
    peak_requests_per_second: number;
  };
  by_scenario: Array<{
    scenario_name: string;
    peak_transactions_per_second: number;
    peak_requests_per_second: number;
  }>;
}

/** Virtual user statistics (overall and per-scenario) */
export interface VirtualUserStats {
  overall: {
    peak_active_threads: number;
    avg_active_threads: number;
  };
  by_scenario: Array<{
    scenario_name: string;
    peak_active_threads: number;
    avg_active_threads: number;
  }>;
}

/** AWR report summary for report rendering */
export interface AwrReportSummary {
  id: string;
  dbName: string | null;
  instanceName: string | null;
  dbEdition: string | null;
  dbRelease: string | null;
  hostName: string | null;
  platform: string | null;
  cpus: number | null;
  cores: number | null;
  memoryGb: number | null;
  beginTime: string | null;
  endTime: string | null;
  elapsedMinutes: number | null;
  dbTimeMinutes: number | null;
  parsedData: Record<string, unknown> | null;
}

/** AWR insight for report rendering */
export interface AwrInsightSummary {
  severity: string;
  category: string;
  title: string;
  description: string;
  recommendation: string | null;
  value: number | null;
  unit: string | null;
}

/** Full AWR data for report rendering */
export interface AwrData {
  reports: AwrReportSummary[];
  insights: AwrInsightSummary[];
  severitySummary: { critical: number; warning: number; info: number; total: number };
}

/** Per-metric comparison detail for report rendering (comparisons section) */
export interface ComparisonMetric {
  dashboardLabel: string;
  panelTitle: string;
  metricName: string;
  unit: string | null;
  currentValue: number | null;
  baselineValue: number | null;
  difference: number | null;
  differencePercent: number | null;
  conclusion: string;
}

/** Full comparisons data for report rendering */
export interface ComparisonsData {
  metrics: ComparisonMetric[];
  regressionCount: number;
  improvementCount: number;
  noDifferenceCount: number;
  totalMetrics: number;
}

/** Per-metric regression/improvement detail for report rendering (regressions section) */
export interface RegressionsMetric {
  dashboardLabel: string;
  panelTitle: string;
  metricName: string;
  unit: string | null;
  conclusionLabel: string;
  testValue: number | null;
  controlValue: number | null;
  difference: number | null;
  differencePercent: number | null;
}

/** Full regressions data for report rendering */
export interface RegressionsData {
  conclusion: string;
  regressionCount: number;
  improvementCount: number;
  totalMetrics: number;
  regressions: RegressionsMetric[];
  improvements: RegressionsMetric[];
  noDifference?: RegressionsMetric[];
}

/** Raw ADAPT result row from database query */
interface AdaptResultRow {
  dashboard_label: string;
  panel_title: string;
  metric_name: string;
  unit: string | null;
  conclusion: Record<string, unknown> | null;
  statistic: Record<string, unknown> | null;
}

/** Raw transaction row from database query */
interface TransactionRow {
  transaction_name: string;
  avg_ms: string;
  p95_ms: string;
  p99_ms: string;
  pass: string;
  fail: string;
  total: string;
}

/** Raw transaction row with Apdex columns from database query */
interface ApdexTransactionRow extends TransactionRow {
  scenario_name: string;
  satisfied: string;
  tolerating: string;
  active_threshold: string;
}

/** A single historical test run summary for trends */
export interface TrendRunSummary {
  testRunId: string;
  startTime: Date;
  applicationRelease: string | null;
  duration: number | null;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  totalTransactions: number;
  consolidatedResult: unknown | null;
}

/** Trends data: current run + historical runs for comparison */
export interface TrendsData {
  currentRun: TrendRunSummary;
  previousRuns: TrendRunSummary[];
}

/** Panel selector for metrics time-series queries */
export interface MetricsPanelSelector {
  dashboardLabel?: string;
  panelTitle?: string;
  metricName?: string;
}

/** A single data point in a metrics time series */
export interface MetricsDataPoint {
  time: Date;
  value: number | null;
}

/** Time-series data for one panel/metric combination */
export interface MetricsTimeSeriesPanel {
  panelTitle: string;
  dashboardLabel: string;
  metricName: string;
  unit: string;
  dataPoints: MetricsDataPoint[];
}

/** Raw metrics row from database query */
interface MetricsTimeSeriesRow {
  time: string;
  value: number | null;
  metric_name: string;
  panel_title: string;
  dashboard_label: string;
  unit: string;
}

/** Raw throughput scenario row from database query */
interface ThroughputScenarioRow {
  scenario_name: string;
  peak_transactions_per_second: string;
  peak_requests_per_second: string;
}

/** Raw virtual user scenario row from database query */
interface VirtualUserScenarioRow {
  scenario_name: string;
  peak_active_threads: string;
  avg_active_threads: string;
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
    if (organizationIds.length === 0) {
      // No org memberships - only allow legacy data (null organization_id)
      return { clause: `AND ${testRunAlias}.organization_id IS NULL`, params: [] };
    }

    // Filter to user's orgs + legacy data (null org_id) for backward compatibility
    const placeholders = organizationIds.map((_, i) => `$${paramStartIndex + i}`).join(', ');
    const clause = `AND (${testRunAlias}.organization_id IN (${placeholders}) OR ${testRunAlias}.organization_id IS NULL)`;

    return { clause, params: organizationIds };
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
    const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);

    let organizationIds: string[] = [];
    if (!skipOrgFilter) {
      organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    }

    const orgFilter = !skipOrgFilter
      ? this.buildOrganizationFilterClause(2, organizationIds, 'tr')
      : { clause: '', params: [] };

    const query = `
      SELECT tr.start_time, tr.ramp_up
      FROM test_runs tr
      WHERE tr.test_run_id = $1
      ${orgFilter.clause}
    `;
    const result = await this.testRunRepo.query(query, [testRunId, ...orgFilter.params]);

    if (result[0]?.start_time && result[0]?.ramp_up) {
      const startTime = new Date(result[0].start_time);
      const rampUpSeconds = parseInt(result[0].ramp_up);
      return new Date(startTime.getTime() + rampUpSeconds * 1000);
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
      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);

      let organizationIds: string[] = [];
      if (!skipOrgFilter) {
        organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      }

      // Build organization filter for test_run validation
      const orgFilter = !skipOrgFilter
        ? this.buildOrganizationFilterClause(3, organizationIds, 'tr')
        : { clause: '', params: [] };

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

      const transactions = await this.testRunRepo.query(query, [testRun.testRunId, scenarioName, ...orgFilter.params]);

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

      const timeSeriesData = await this.testRunRepo.query(timeSeriesQuery, [testRun.testRunId, scenarioName, ...orgFilter.params]);

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
      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);

      let organizationIds: string[] = [];
      if (!skipOrgFilter) {
        organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      }

      const testRunId = testRun.testRunId;

      // Get ramp-up cutoff time if needed (pass userId/roles for org filtering)
      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp, userId, roles);

      // Build organization filter for queries
      // Base params are: [testRunId, excludeRampUp, cutoffTime] = indices 1, 2, 3
      // Organization params start at index 4
      const orgFilter = !skipOrgFilter
        ? this.buildOrganizationFilterClause(4, organizationIds, 'tr')
        : { clause: '', params: [] };

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
          ON wat.system_under_test_id = sut.name
          AND wat.test_environment = tr.test_environment
          AND wat.workload = tr.workload
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON wtat.system_under_test_id = sut.name
          AND wtat.test_environment = tr.test_environment
          AND wtat.workload = tr.workload
          AND wtat.transaction_name = t.transaction_name
        WHERE t.test_run_id = $1
          AND ($2::boolean = false OR t.time >= $3::timestamptz)
          ${orgFilter.clause}
        GROUP BY t.transaction_name, t.scenario_name, wtat.apdex_threshold, wat.apdex_threshold
        ORDER BY t.scenario_name, t.transaction_name
      `;

      const allTransactions: ApdexTransactionRow[] = await this.testRunRepo.query(allTransactionsQuery, queryParams);

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
      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);

      // Load organizations from AuthorizationService for non-admin/non-system users
      let organizationIds: string[] = [];
      if (!skipOrgFilter) {
        organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      }

      // Build organization filter for test_run validation
      // Base params are: [testRunId, excludeRampUp, cutoffTime] = indices 1, 2, 3
      // Organization params start at index 4
      const orgFilter = !skipOrgFilter
        ? this.buildOrganizationFilterClause(4, organizationIds, 'tr')
        : { clause: '', params: [] };

      // Build the org filter CTE clause using tr.organization_id directly
      const orgFilterCte = !skipOrgFilter
        ? organizationIds.length > 0
          ? `, org_filter AS (
              SELECT tr.test_run_id FROM test_runs tr
              WHERE tr.test_run_id = $1
                AND (tr.organization_id IN (${organizationIds.map((_, i) => `$${4 + i}`).join(', ')}) OR tr.organization_id IS NULL)
            )`
          : `, org_filter AS (
              SELECT tr.test_run_id FROM test_runs tr
              WHERE tr.test_run_id = $1 AND tr.organization_id IS NULL
            )`
        : '';

      const orgFilterJoin = !skipOrgFilter
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
        this.testRunRepo.query(transactionsQuery, queryParams),
        this.testRunRepo.query(requestsQuery, queryParams),
        this.testRunRepo.query(scenarioQuery, queryParams),
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
      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);

      // Load organizations from AuthorizationService for non-admin/non-system users
      let organizationIds: string[] = [];
      if (!skipOrgFilter) {
        organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      }

      // Build organization filter for test_run validation
      // Base params are: [testRunId, excludeRampUp, cutoffTime] = indices 1, 2, 3
      // Organization params start at index 4
      const orgFilter = !skipOrgFilter
        ? this.buildOrganizationFilterClause(4, organizationIds, 'tr')
        : { clause: '', params: [] };

      // Build organization filter using tr.organization_id directly
      const orgFilterJoinClause = !skipOrgFilter
        ? organizationIds.length > 0
          ? `AND EXISTS (
              SELECT 1 FROM test_runs tr
              WHERE tr.test_run_id = vu.test_run_id
                AND (tr.organization_id IN (${organizationIds.map((_, i) => `$${4 + i}`).join(', ')}) OR tr.organization_id IS NULL)
            )`
          : `AND EXISTS (
              SELECT 1 FROM test_runs tr
              WHERE tr.test_run_id = vu.test_run_id AND tr.organization_id IS NULL
            )`
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
        this.testRunRepo.query(overallQuery, queryParams),
        this.testRunRepo.query(scenarioQuery, queryParams),
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
   * Get AWR data for a test run
   * Fetches AWR reports and their analysis insights
   */
  async getAwrData(testRunId: string): Promise<AwrData | null> {
    try {
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
        [testRunId],
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
  async getSloCheckResults(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<SloCheckResult[]> {
    try {
      const rows: SloCheckResult[] = await this.dataSource.query(
        `SELECT
          cr.benchmark_id,
          cr.panel_title,
          cr.metric_name,
          cr.metric_unit,
          cr.evaluate_type,
          cr.source,
          cr.dashboard_label,
          cr.requirement->>'operator' AS requirement_operator,
          (cr.requirement->>'value')::numeric AS requirement_value,
          cr.panel_average,
          cr.meets_requirement
        FROM check_results cr
        WHERE cr.test_run_id = $1
        ORDER BY cr.meets_requirement ASC NULLS LAST, cr.evaluate_type, cr.panel_title`,
        [testRunId],
      );

      return rows;
    } catch (error) {
      this.logger.warn(`Failed to get SLO check results for ${testRunId}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Get SLO check result summary for a test run.
   * Queries check_results table and counts passed/failed using the meets_requirement column.
   */
  async getSloSummary(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
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
   * Get comparisons data for a test run
   * Fetches ADAPT results comparing current run vs control group
   */
  async getComparisonsData(testRunId: string, _baselineTestRunId?: string): Promise<ComparisonsData | null> {
    try {
      const resultRows: Array<{
        dashboard_label: string;
        panel_title: string;
        metric_name: string;
        unit: string | null;
        conclusion: Record<string, unknown> | null;
        statistic: Record<string, unknown> | null;
      }> = await this.dataSource.query(
        `SELECT dashboard_label, panel_title, metric_name, unit, conclusion, statistic
         FROM ds_adapt_results
         WHERE test_run_id = $1
         ORDER BY dashboard_label ASC, panel_title ASC, metric_name ASC`,
        [testRunId],
      );

      if (resultRows.length === 0) return null;

      const metrics: ComparisonMetric[] = resultRows.map((row) => {
        const conclusion = row.conclusion as Record<string, unknown> | null;
        const statistic = row.statistic as Record<string, unknown> | null;
        const conclusionLabel = conclusion && typeof conclusion.label === 'string'
          ? conclusion.label : 'unknown';
        const testValue = statistic?.test != null ? Number(statistic.test) : null;
        const controlValue = statistic?.control != null ? Number(statistic.control) : null;
        const diff = statistic?.diff != null ? Number(statistic.diff) : null;
        const diffPct = controlValue && controlValue !== 0 && diff != null
          ? (diff / Math.abs(controlValue)) * 100 : null;

        return {
          dashboardLabel: row.dashboard_label,
          panelTitle: row.panel_title,
          metricName: row.metric_name,
          unit: row.unit || null,
          currentValue: testValue,
          baselineValue: controlValue,
          difference: diff,
          differencePercent: diffPct,
          conclusion: conclusionLabel,
        };
      });

      return {
        metrics,
        regressionCount: metrics.filter((m) => m.conclusion === 'regression').length,
        improvementCount: metrics.filter((m) => m.conclusion === 'improvement').length,
        noDifferenceCount: metrics.filter((m) => m.conclusion === 'no_difference').length,
        totalMetrics: metrics.length,
      };
    } catch (error) {
      this.logger.warn(`Failed to get comparisons data for ${testRunId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get detailed regression/improvement data for a test run.
   * Queries ds_adapt_conclusion for summary and ds_adapt_results for per-metric details.
   */
  async getRegressionsData(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<RegressionsData | null> {
    try {
      // Get overall conclusion
      const conclusionRows: {
        conclusion: string;
        regressions: string[] | null;
        improvements: string[] | null;
      }[] = await this.dataSource.query(
        `SELECT conclusion, regressions, improvements FROM ds_adapt_conclusion WHERE test_run_id = $1 LIMIT 1`,
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
        noDifference: metrics.filter((m) => m.conclusionLabel === 'no_difference'),
      };
    } catch (error) {
      this.logger.warn(`Failed to get regressions data for ${testRunId}: ${(error as Error).message}`);
      return null;
    }
  }

  async getAnomalySummary(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
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
  ): Promise<TrendsData | null> {
    try {
      const safeMaxRuns = Math.max(1, Math.min(Math.floor(maxRuns), 50));
      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);

      let organizationIds: string[] = [];
      if (!skipOrgFilter) {
        organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      }

      const orgFilter = !skipOrgFilter
        ? this.buildOrganizationFilterClause(5, organizationIds, 'tr')
        : { clause: '', params: [] };

      // Fetch recent completed runs for the same system/environment/workload
      const query = `
        SELECT
          tr.test_run_id,
          tr.start_time,
          tr.application_release,
          tr.duration,
          tr.consolidated_result,
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
          ${orgFilter.clause}
        ORDER BY tr.start_time DESC
        LIMIT ${safeMaxRuns + 1}
      `;

      const rows = await this.testRunRepo.query(query, [
        testRun.systemUnderTestId,
        testRun.testEnvironment,
        testRun.workload,
        testRun.startTime || new Date(),
        ...orgFilter.params,
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

      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);
      let organizationIds: string[] = [];
      if (!skipOrgFilter) {
        organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      }

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
        if (!skipOrgFilter) {
          const orgFilter = this.buildOrganizationFilterClause(paramIdx, organizationIds, 'tr');
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

        const rows: MetricsTimeSeriesRow[] = await this.testRunRepo.query(query, params);

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
   * Auto-discover available panels for a test run from ds_metrics.
   * Used when no explicit panel selection is provided.
   */
  async getAvailableMetricsPanels(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<MetricsPanelSelector[]> {
    try {
      const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);
      let orgClause = '';
      const params: unknown[] = [testRunId];

      if (!skipOrgFilter) {
        const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        const orgFilter = this.buildOrganizationFilterClause(2, organizationIds, 'tr');
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
        await this.testRunRepo.query(query, params);

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
