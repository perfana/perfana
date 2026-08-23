import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService, BenchmarkNotFoundError } from './BaseCheckService.js';

export interface TestRun {
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  organization_id?: string;
  team_id?: string | null;
  start_time?: Date;
  end_time?: Date;
  ramp_up?: number;
}

type BenchmarkType = 'metric' | 'apdex' | 'aggregated';

export interface Benchmark {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  dashboard_uid: string;
  dashboard_label: string;
  application_dashboard_id: string;
  configuration: unknown;
  requirement_operator?: string;
  requirement_value?: number;
  validate_with_default_if_no_data: boolean;
  validate_with_default_if_no_data_value?: number;
  average_all: boolean;
  exclude_ramp_up_time: boolean;
  panel_title?: string;
  evaluate_type?: string;
  metric_unit?: string;
  valid: boolean;
  enabled: boolean;
  // Apdex SLO fields
  benchmark_type: BenchmarkType;
  transaction_name?: string;
  apdex_threshold_ms?: number;
  min_apdex_score?: number;
  include_failed_requests: boolean;
  // Aggregated SLO fields
  aggregate_metric?: string;
  aggregate_stat?: string;
}

/**
 * Service to find matching benchmarks for test runs
 * Based on benchmark_matcher.py:26-134
 */
export class BenchmarkMatcher extends BaseCheckService {
  constructor(
    logger: Logger,
    private manager: EntityManager
  ) {
    super(logger);
  }

  /**
   * Find all benchmarks that match the test run criteria
   * Based on benchmark_matcher.py:33-89
   */
  async findMatchingBenchmarks(
    testRun: TestRun,
    metricFilter?: {
      applicationDashboardId?: string;
      panelId?: number;
      metricName?: string;
    }
  ): Promise<Benchmark[]> {
    if (metricFilter) {
      this.logger.info(
        `Finding benchmarks for test run ${testRun.test_run_id} ` +
        `(SUT: ${testRun.system_under_test_id}, env: ${testRun.test_environment}, workload: ${testRun.workload}) ` +
        `with metric filter: dashboard=${metricFilter.applicationDashboardId}, panel=${metricFilter.panelId}, metric=${metricFilter.metricName}`
      );
    } else {
      this.logger.info(
        `Finding benchmarks for test run ${testRun.test_run_id} ` +
        `(SUT: ${testRun.system_under_test_id}, env: ${testRun.test_environment}, workload: ${testRun.workload})`
      );
    }

    // Query benchmarks collection for matches
    // Based on benchmark_matcher.py:51-57
    // Build dynamic WHERE clause based on metric filter
    // Note: Apdex benchmarks use min_apdex_score instead of requirement_operator/requirement_value
    const whereClauses = [
      'system_under_test_id = $1',
      'test_environment = $2',
      'workload = $3',
      'valid = true',
      'enabled = true',
      `(
        (COALESCE(benchmark_type, 'metric') = 'metric' AND (requirement_operator IS NOT NULL OR requirement_value IS NOT NULL))
        OR
        (benchmark_type = 'apdex' AND min_apdex_score IS NOT NULL)
        OR
        (benchmark_type = 'aggregated' AND aggregate_metric IS NOT NULL AND requirement_value IS NOT NULL)
      )`
    ];

    const queryParams: unknown[] = [
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload
    ];

    // RBAC: Filter by organization (backward compatible with NULL)
    if (testRun.organization_id) {
      whereClauses.push(`(organization_id = $${queryParams.length + 1} OR organization_id IS NULL)`);
      queryParams.push(testRun.organization_id);
    }

    // Add metric filter conditions if provided
    if (metricFilter?.applicationDashboardId) {
      whereClauses.push(`application_dashboard_id = $${queryParams.length + 1}`);
      queryParams.push(metricFilter.applicationDashboardId);
    }

    // Note: panelId filter is applied via configuration->id field (JSONB)
    if (metricFilter?.panelId !== undefined) {
      whereClauses.push(`(configuration->>'id')::int = $${queryParams.length + 1}`);
      queryParams.push(metricFilter.panelId);
    }

    const benchmarksSql = `
      SELECT
        id,
        system_under_test_id,
        test_environment,
        workload,
        dashboard_uid,
        dashboard_label,
        application_dashboard_id,
        configuration,
        requirement_operator,
        requirement_value,
        validate_with_default_if_no_data,
        validate_with_default_if_no_data_value,
        average_all,
        exclude_ramp_up_time,
        panel_title,
        evaluate_type,
        metric_unit,
        valid,
        enabled,
        COALESCE(benchmark_type, 'metric') as benchmark_type,
        transaction_name,
        apdex_threshold_ms,
        min_apdex_score,
        COALESCE(include_failed_requests, false) as include_failed_requests,
        aggregate_metric,
        aggregate_stat
      FROM benchmarks
      WHERE ${whereClauses.join('\n        AND ')}
    `;

    const result = await this.manager.query(benchmarksSql, queryParams) as Record<string, unknown>[];

    if (result.length === 0) {
      throw new BenchmarkNotFoundError(
        `No benchmarks found for SUT=${testRun.system_under_test_id}, ` +
        `testEnvironment=${testRun.test_environment}, workload=${testRun.workload}`
      );
    }

    // Convert rows to Benchmark objects and validate
    // Based on benchmark_matcher.py:66-88
    const benchmarks: Benchmark[] = result.map((row) => ({
      id: row.id as string,
      system_under_test_id: row.system_under_test_id as string,
      test_environment: row.test_environment as string,
      workload: row.workload as string,
      dashboard_uid: row.dashboard_uid as string,
      dashboard_label: row.dashboard_label as string,
      application_dashboard_id: row.application_dashboard_id as string,
      configuration: row.configuration,
      requirement_operator: row.requirement_operator as string | undefined,
      requirement_value: row.requirement_value as number | undefined,
      validate_with_default_if_no_data: (row.validate_with_default_if_no_data as boolean) || false,
      validate_with_default_if_no_data_value: row.validate_with_default_if_no_data_value as number | undefined,
      average_all: (row.average_all as boolean) || false,
      exclude_ramp_up_time: row.exclude_ramp_up_time !== false, // Default true
      panel_title: row.panel_title as string | undefined,
      evaluate_type: row.evaluate_type as string | undefined,
      metric_unit: row.metric_unit as string | undefined,
      valid: row.valid !== false, // Default true
      enabled: row.enabled !== false, // Default true
      // Apdex SLO fields
      benchmark_type: ((row.benchmark_type as string) || 'metric') as BenchmarkType,
      transaction_name: row.transaction_name as string | undefined,
      apdex_threshold_ms: row.apdex_threshold_ms as number | undefined,
      min_apdex_score: row.min_apdex_score ? parseFloat(String(row.min_apdex_score)) : undefined,
      include_failed_requests: (row.include_failed_requests as boolean) || false,
      // Aggregated SLO fields
      aggregate_metric: row.aggregate_metric as string | undefined,
      aggregate_stat: row.aggregate_stat as string | undefined,
    }));

    // Filter out invalid benchmarks
    // Based on benchmark_matcher.py:82-88
    const validBenchmarks = benchmarks.filter(b => this.isBenchmarkValid(b));

    this.logger.info(
      `Found ${validBenchmarks.length} valid benchmarks (out of ${benchmarks.length} total)`
    );

    return validBenchmarks;
  }

  /**
   * Find a specific benchmark by ID
   * Based on benchmark_matcher.py:90-99
   */
  async findBenchmarkById(benchmarkId: string): Promise<Benchmark | null> {
    const sql = `
      SELECT
        id,
        system_under_test_id,
        test_environment,
        workload,
        dashboard_uid,
        dashboard_label,
        application_dashboard_id,
        configuration,
        requirement_operator,
        requirement_value,
        validate_with_default_if_no_data,
        validate_with_default_if_no_data_value,
        average_all,
        exclude_ramp_up_time,
        panel_title,
        evaluate_type,
        metric_unit,
        valid,
        enabled,
        COALESCE(benchmark_type, 'metric') as benchmark_type,
        transaction_name,
        apdex_threshold_ms,
        min_apdex_score,
        COALESCE(include_failed_requests, false) as include_failed_requests,
        aggregate_metric,
        aggregate_stat
      FROM benchmarks
      WHERE id = $1
    `;

    const result = await this.manager.query(sql, [benchmarkId]);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: row.id,
      system_under_test_id: row.system_under_test_id,
      test_environment: row.test_environment,
      workload: row.workload,
      dashboard_uid: row.dashboard_uid,
      dashboard_label: row.dashboard_label,
      application_dashboard_id: row.application_dashboard_id,
      configuration: row.configuration,
      requirement_operator: row.requirement_operator,
      requirement_value: row.requirement_value,
      validate_with_default_if_no_data: row.validate_with_default_if_no_data || false,
      validate_with_default_if_no_data_value: row.validate_with_default_if_no_data_value,
      average_all: row.average_all || false,
      exclude_ramp_up_time: row.exclude_ramp_up_time !== false,
      panel_title: row.panel_title,
      evaluate_type: row.evaluate_type,
      metric_unit: row.metric_unit,
      valid: row.valid !== false,
      enabled: row.enabled !== false,
      // Apdex SLO fields
      benchmark_type: row.benchmark_type || 'metric',
      transaction_name: row.transaction_name,
      apdex_threshold_ms: row.apdex_threshold_ms,
      min_apdex_score: row.min_apdex_score ? parseFloat(String(row.min_apdex_score)) : undefined,
      include_failed_requests: row.include_failed_requests || false,
      // Aggregated SLO fields
      aggregate_metric: row.aggregate_metric,
      aggregate_stat: row.aggregate_stat,
    };
  }

  /**
   * Check if a benchmark is valid for processing
   * Based on benchmark_matcher.py:101-130
   */
  private isBenchmarkValid(benchmark: Benchmark): boolean {
    // Check if benchmark is explicitly marked as invalid
    // Based on benchmark_matcher.py:111-115
    if (benchmark.valid === false) {
      this.logger.debug(
        `Benchmark ${benchmark.id} is marked as invalid`
      );
      return false;
    }

    // Check if benchmark has required fields based on type
    if (benchmark.benchmark_type === 'apdex') {
      // Apdex benchmarks need min_apdex_score
      if (benchmark.min_apdex_score === null || benchmark.min_apdex_score === undefined) {
        this.logger.debug(
          `Apdex benchmark ${benchmark.id} missing min_apdex_score`
        );
        return false;
      }
    } else if (benchmark.benchmark_type === 'aggregated') {
      // Aggregated benchmarks need aggregate_metric and requirement_value
      if (!benchmark.aggregate_metric || benchmark.requirement_value === undefined) {
        this.logger.debug(
          `Aggregated benchmark ${benchmark.id} missing aggregate_metric or requirement_value`
        );
        return false;
      }
    } else {
      // Metric benchmarks need requirement_operator or requirement_value
      // Based on benchmark_matcher.py:117-128
      if (!benchmark.requirement_operator && benchmark.requirement_value === null) {
        this.logger.debug(
          `Benchmark ${benchmark.id} missing requirement configuration`
        );
        return false;
      }
    }

    return true;
  }
}