import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { AuthorizationService } from '../../../common/services/authorization.service';

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
  ): Promise<any | null> {
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
        transactions: transactions.map((txn: any) => ({
          name: txn.transaction_name,
          avgMs: parseFloat(txn.avg_ms) || 0,
          p95Ms: parseFloat(txn.p95_ms) || 0,
          p99Ms: parseFloat(txn.p99_ms) || 0,
          pass: parseInt(txn.pass) || 0,
          fail: parseInt(txn.fail) || 0,
          errPct: txn.total > 0 ? ((parseInt(txn.fail) / parseInt(txn.total)) * 100) : 0,
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
    apdexThreshold: number,
    excludeRampUp: boolean = false,
    userId: string = '',
    roles: string[] = [],
  ): Promise<any | null> {
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

      const allTransactions = await this.testRunRepo.query(allTransactionsQuery, queryParams);

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
      const scenarioMap: Record<string, any[]> = {};
      for (const txn of allTransactions) {
        const scenarioName = txn.scenario_name || 'Unknown';
        if (!scenarioMap[scenarioName]) {
          scenarioMap[scenarioName] = [];
        }
        scenarioMap[scenarioName].push(txn);
      }

      const scenarios: Record<string, any> = {};

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

        const transactions = scenarioTransactions.map((txn: any) => {
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
          };
        });

        const scenarioApdex = scenarioTotal > 0 ? scenarioWeightedApdex / scenarioTotal : 0;
        const scenarioAvg = scenarioTotal > 0 ? Math.round((scenarioWeightedAvg / scenarioTotal) * 100) / 100 : 0;
        const scenarioP95 = scenarioTotal > 0 ? Math.round((scenarioWeightedP95 / scenarioTotal) * 100) / 100 : 0;
        const scenarioP99 = scenarioTotal > 0 ? Math.round((scenarioWeightedP99 / scenarioTotal) * 100) / 100 : 0;
        const errorRate = scenarioTotal > 0 ? (scenarioFailed / scenarioTotal) * 100 : 0;

        // Get peak metrics for this scenario
        const scenarioThroughput = throughputStats.by_scenario.find((s: any) => s.scenario_name === scenarioName);
        const scenarioVirtualUsers = virtualUserStats.by_scenario.find((s: any) => s.scenario_name === scenarioName);

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
          threshold: apdexThreshold,
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
  ): Promise<any> {
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
        by_scenario: scenarioResult.map((row: any) => ({
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
  ): Promise<any> {
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
        by_scenario: scenarioResult.map((row: any) => ({
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
  getMockScenarioData(scenarioName: string): any | null {
    // Mock data structure matching the PDF example
    const mockScenarios: Record<string, any> = {
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
}
