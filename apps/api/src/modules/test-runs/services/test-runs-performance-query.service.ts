import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { TestRun as TestRunEntity } from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { TestRunsMapperService } from './test-runs-mapper.service';
import {
  TransactionStats,
  SamplerStats,
  ErrorStats,
  VirtualUserStats,
  ThroughputStats,
} from '../types/test-run.types';

/**
 * Service responsible for performance analysis queries
 * Handles: transaction stats, sampler stats, error analysis, virtual users, throughput
 */
@Injectable()
export class TestRunsPerformanceQueryService {
  private readonly logger = new Logger(TestRunsPerformanceQueryService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly mapper: TestRunsMapperService,
  ) {}

  /**
   * Resolve UUID or test_run_id to the actual test_run_id string
   * Supports both UUID (e.g., "e8f37dc1-9d9c-4e25-837d-14aa69ac4b17")
   * and test_run_id string (e.g., "PerfanaWebshop-acc-loadTest-00012")
   */
  private async resolveTestRunId(testRunIdOrUuid: string): Promise<string> {
    // Check if it's a UUID (contains dashes in UUID format)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testRunIdOrUuid);

    if (isUuid) {
      // Look up test_run_id by UUID
      const query = `SELECT test_run_id FROM test_runs WHERE id = $1`;
      const result = await withRequestEm(this.testRunRepo).query(query, [testRunIdOrUuid]);
      if (!result || result.length === 0) {
        throw new DatabaseException(`Test run not found with UUID: ${testRunIdOrUuid}`);
      }
      return result[0].test_run_id;
    }

    // Already a test_run_id string
    return testRunIdOrUuid;
  }

  /**
   * Get ramp-up cutoff time for a test run
   */
  private async getRampUpCutoffTime(testRunId: string, excludeRampUp: boolean): Promise<Date | null> {
    if (!excludeRampUp) return null;

    const query = `
      SELECT start_time, ramp_up
      FROM test_runs
      WHERE test_run_id = $1
    `;
    const result = await withRequestEm(this.testRunRepo).query(query, [testRunId]);

    if (result[0]?.start_time && result[0]?.ramp_up) {
      const startTime = new Date(result[0].start_time);
      const analysisStartOffsetSeconds = this.mapper.parseInt(result[0].ramp_up);
      return new Date(startTime.getTime() + analysisStartOffsetSeconds * 1000);
    }

    return null;
  }

  /**
   * Check whether pre-computed transaction stats exist for a test run
   * (test_run_transaction_stats is populated by TransactionStatsRollupPipeline
   * at finalization). When false, the live-aggregation path runs instead.
   */
  private async hasTransactionRollup(testRunId: string): Promise<boolean> {
    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT 1 FROM test_run_transaction_stats WHERE test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    return result.length > 0;
  }

  /**
   * Check whether pre-computed sampler stats exist for a (test_run, transaction)
   * pair. When false, the live-aggregation path over requests_raw runs instead.
   */
  private async hasSamplerRollup(testRunId: string, transactionName: string): Promise<boolean> {
    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT 1 FROM test_run_sampler_stats
       WHERE test_run_id = $1 AND transaction_name = $2 LIMIT 1`,
      [testRunId, transactionName],
    );
    return result.length > 0;
  }

  /**
   * Fast-path transaction stats read: pull pre-computed tdigest + counts from
   * test_run_transaction_stats, then join current thresholds and compute
   * Apdex / p95 / p99 at read time. Threshold edits take effect immediately;
   * no rollup recompute needed.
   *
   * See: issues #150, #151.
   */
  private async getTransactionStatsFromRollup(
    resolvedTestRunId: string,
    excludeRampUp: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<TransactionStats[]> {
    const orgFilterClause = !isAdmin
      ? `AND sut.organization_id = ANY($3::uuid[])`
      : '';

    const query = `
      WITH agg AS (
        SELECT
          trs.transaction_name,
          NULLIF(trs.scenario_name, '')              AS scenario_name,
          trs.system_under_test_id,
          trs.test_environment,
          trs.workload,
          trs.total_count,
          trs.passed_count,
          trs.failed_count,
          trs.avg_response_time,
          trs.pct_agg,
          trs.impact_score
        FROM test_run_transaction_stats trs
        JOIN test_runs tr ON tr.test_run_id = trs.test_run_id
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE trs.test_run_id = $1
          AND trs.ramp_up_excluded = $2
          AND trs.total_count > 0
          ${orgFilterClause}
      ),
      thresholds AS (
        SELECT
          a.transaction_name,
          a.scenario_name,
          COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
        FROM agg a
        LEFT JOIN workload_apdex_thresholds wat
          ON  wat.system_under_test_id = a.system_under_test_id
          AND wat.test_environment     = a.test_environment
          AND wat.workload             = a.workload
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON  wtat.system_under_test_id = a.system_under_test_id
          AND wtat.test_environment     = a.test_environment
          AND wtat.workload             = a.workload
          AND wtat.transaction_name     = a.transaction_name
      ),
      scored AS (
        SELECT
          a.transaction_name,
          a.scenario_name,
          a.total_count,
          a.passed_count,
          a.failed_count,
          a.avg_response_time,
          ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
          ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
          a.impact_score,
          th.active_threshold,
          ROUND(
            (
              approx_percentile_rank(th.active_threshold::double precision, a.pct_agg)
              + (approx_percentile_rank((th.active_threshold * 4)::double precision, a.pct_agg)
                 - approx_percentile_rank(th.active_threshold::double precision, a.pct_agg)) / 2
            )::numeric,
            3
          ) AS apdex_score
        FROM agg a
        JOIN thresholds th
          ON  th.transaction_name = a.transaction_name
          AND th.scenario_name IS NOT DISTINCT FROM a.scenario_name
      )
      SELECT
        transaction_name,
        scenario_name,
        total_count,
        passed_count,
        failed_count,
        avg_response_time,
        p95_response_time,
        p99_response_time,
        impact_score,
        active_threshold,
        apdex_score,
        RANK() OVER (ORDER BY impact_score DESC) AS ranking
      FROM scored
      ORDER BY transaction_name ASC
    `;

    const params: unknown[] = !isAdmin
      ? [resolvedTestRunId, excludeRampUp, organizationIds]
      : [resolvedTestRunId, excludeRampUp];

    const result = await withRequestEm(this.testRunRepo).query(query, params);

    this.logger.log(
      `Retrieved ${result.length} transaction stats (rollup) for test run: ${resolvedTestRunId} (excludeRampUp: ${excludeRampUp})`,
    );

    return result.map((row: Record<string, unknown>) => ({
      transaction_name: row.transaction_name as string,
      scenario_name: (row.scenario_name as string) || undefined,
      avg_response_time: this.mapper.parseFloat(row.avg_response_time),
      p95_response_time: this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: this.mapper.parseFloat(row.p99_response_time),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
      total_count: this.mapper.parseInt(row.total_count),
      ranking: this.mapper.parseFloat(row.ranking),
      apdex_score: this.mapper.parseFloat(row.apdex_score),
      active_threshold: this.mapper.parseInt(row.active_threshold, 500),
    }));
  }

  /**
   * Fast-path sampler stats read: pulls pre-computed tdigest + counts from
   * test_run_sampler_stats filtered by `ramp_up_excluded`, joins current
   * threshold + url_patterns, and computes Apdex / p95 / p99 at read time.
   *
   * Replaces the 140s live query for `stream_download_segment` (#151).
   */
  private async getTransactionSamplesFromRollup(
    resolvedTestRunId: string,
    transactionName: string,
    excludeRampUp: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<SamplerStats[]> {
    const orgFilterClause = !isAdmin
      ? `AND sut.organization_id = ANY($4::uuid[])`
      : '';

    const query = `
      WITH threshold_config AS (
        SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
        FROM test_runs tr
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN workload_apdex_thresholds wat
          ON  wat.system_under_test_id = sut.id
          AND wat.test_environment     = tr.test_environment
          AND wat.workload             = tr.workload
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON  wtat.system_under_test_id = sut.id
          AND wtat.test_environment     = tr.test_environment
          AND wtat.workload             = tr.workload
          AND wtat.transaction_name     = $2
        WHERE tr.test_run_id = $1
          ${orgFilterClause}
        LIMIT 1
      ),
      agg AS (
        SELECT
          trss.sampler_name,
          NULLIF(trss.scenario_name, '')  AS scenario_name,
          trss.system_under_test,
          trss.test_environment,
          trss.url_hash,
          trss.avg_response_time,
          trss.min_response_time,
          trss.max_response_time,
          trss.pct_agg,
          trss.passed_count,
          trss.failed_count,
          trss.total_count,
          trss.avg_latency,
          trss.avg_connect_time,
          trss.total_request_size,
          trss.total_response_size
        FROM test_run_sampler_stats trss
        WHERE trss.test_run_id = $1
          AND trss.transaction_name = $2
          AND trss.ramp_up_excluded = $3
          AND trss.total_count > 0
      )
      SELECT
        a.sampler_name,
        a.scenario_name,
        a.url_hash,
        LOWER(up.normalized_url) AS url_pattern,
        a.avg_response_time,
        a.min_response_time,
        a.max_response_time,
        ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
        ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
        a.passed_count,
        a.failed_count,
        a.total_count,
        a.avg_latency,
        a.avg_connect_time,
        a.total_request_size,
        a.total_response_size,
        tc.active_threshold,
        ROUND(
          (
            approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg)
            + (approx_percentile_rank((tc.active_threshold * 4)::double precision, a.pct_agg)
               - approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg)) / 2
          )::numeric,
          3
        ) AS apdex_score
      FROM agg a
      CROSS JOIN threshold_config tc
      LEFT JOIN url_patterns up
        ON  a.url_hash         = up.url_hash
        AND a.system_under_test = up.system_under_test
        AND a.test_environment  = up.test_environment
      ORDER BY a.total_count DESC
    `;

    const params: unknown[] = !isAdmin
      ? [resolvedTestRunId, transactionName, excludeRampUp, organizationIds]
      : [resolvedTestRunId, transactionName, excludeRampUp];

    const result = await withRequestEm(this.testRunRepo).query(query, params);

    this.logger.log(
      `Retrieved ${result.length} aggregated samplers (rollup) for transaction: ${transactionName} (excludeRampUp: ${excludeRampUp})`,
    );

    return result.map((row: Record<string, unknown>) => ({
      sampler_name: row.sampler_name as string,
      scenario_name: (row.scenario_name as string) || undefined,
      avg_response_time: this.mapper.parseFloat(row.avg_response_time),
      min_response_time: this.mapper.parseInt(row.min_response_time),
      max_response_time: this.mapper.parseInt(row.max_response_time),
      p95_response_time: this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: this.mapper.parseFloat(row.p99_response_time),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
      total_count: this.mapper.parseInt(row.total_count),
      avg_latency: this.mapper.parseFloat(row.avg_latency),
      avg_connect_time: this.mapper.parseFloat(row.avg_connect_time),
      total_request_size: this.mapper.parseInt(row.total_request_size),
      total_response_size: this.mapper.parseInt(row.total_response_size),
      apdex_score: this.mapper.parseFloat(row.apdex_score),
      active_threshold: this.mapper.parseInt(row.active_threshold, 500),
      url_hash: (row.url_hash as string) || null,
      url_pattern: (row.url_pattern as string) || null,
    }));
  }

  /**
   * Get transaction performance statistics for a test run.
   *
   * Percentiles (p95/p99) and Apdex are computed via TimescaleDB toolkit's
   * `percentile_agg` (uddsketch) + `approx_percentile` / `approx_percentile_rank`.
   * Expected error vs exact `PERCENTILE_CONT`: <1% at p95/p99 for the response-time
   * distribution shapes Perfana sees. The tradeoff buys us a single-pass O(n)
   * aggregation instead of an O(n log n) full sort that spilled to disk on large runs.
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getTransactionStats(
    testRunId: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    sinceMinutes?: number,
  ): Promise<TransactionStats[]> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty transaction stats');
        return [];
      }

      this.logger.log(`Getting transaction stats for test run: ${testRunId} (excludeRampUp: ${excludeRampUp}${sinceMinutes != null ? `, sinceMinutes: ${sinceMinutes}` : ''})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);
      this.logger.debug(`Resolved test run ID: ${testRunId} -> ${resolvedTestRunId}`);

      // Fast path: if the rollup stage has written rows for this test run
      // (completed runs only) AND sinceMinutes is not set (the rollup is
      // whole-test-run only), read from the rollup table. Dashboard latency
      // drops from seconds-to-minutes to <100ms.
      // See: issues #150, #151.
      if (sinceMinutes == null) {
        const hasRollup = await this.hasTransactionRollup(resolvedTestRunId);
        if (hasRollup) {
          return await this.getTransactionStatsFromRollup(
            resolvedTestRunId,
            excludeRampUp,
            isAdmin,
            organizationIds,
          );
        }
      }

      const cutoffTime = await this.getRampUpCutoffTime(resolvedTestRunId, excludeRampUp);

      // Param layout (1-indexed):
      //   $1 = resolvedTestRunId
      //   $2 = excludeRampUp
      //   $3 = cutoffTime
      //   $4 = sinceMinutes  (only when provided)
      //   $4 or $5 = organizationIds (non-admin only; index shifts when sinceMinutes present)
      const windowParamIndex = 4;
      const orgParamIndex = sinceMinutes != null ? 5 : 4;

      const windowFilter = sinceMinutes != null
        ? `AND t.time >= NOW() - ($${windowParamIndex}::numeric * interval '1 minute')`
        : '';

      const orgFilterClause = !isAdmin
        ? `AND sut.organization_id = ANY($${orgParamIndex}::uuid[])`
        : '';

      // Aggregate transactions FIRST, then join threshold tables against the
      // post-group result (tens of rows) instead of the ungrouped row stream.
      // p95/p99 come from a single percentile_agg tdigest per group; Apdex uses
      // approx_percentile_rank on the same sketch — one pass, no full sort.
      const query = `
        WITH agg AS (
          SELECT
            t.transaction_name,
            t.scenario_name,
            tr.system_under_test_id,
            tr.test_environment,
            tr.workload,
            COUNT(*)                                              AS total_count,
            COUNT(*) FILTER (WHERE t.success)                     AS passed_count,
            COUNT(*) FILTER (WHERE NOT t.success)                 AS failed_count,
            ROUND(AVG(t.response_time)::numeric, 2)               AS avg_response_time,
            percentile_agg(t.response_time::double precision)     AS pct_agg,
            ROUND((AVG(t.response_time) * COUNT(*))::numeric, 2)  AS impact_score
          FROM transactions t
          JOIN test_runs tr ON tr.test_run_id = t.test_run_id
          JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          WHERE t.test_run_id = $1
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
            ${windowFilter}
            ${orgFilterClause}
          GROUP BY t.transaction_name, t.scenario_name, tr.system_under_test_id, tr.test_environment, tr.workload
        ),
        thresholds AS (
          SELECT
            a.transaction_name,
            a.scenario_name,
            COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
          FROM agg a
          LEFT JOIN workload_apdex_thresholds wat
            ON  wat.system_under_test_id = a.system_under_test_id
            AND wat.test_environment     = a.test_environment
            AND wat.workload             = a.workload
          LEFT JOIN workload_transaction_apdex_thresholds wtat
            ON  wtat.system_under_test_id = a.system_under_test_id
            AND wtat.test_environment     = a.test_environment
            AND wtat.workload             = a.workload
            AND wtat.transaction_name     = a.transaction_name
        ),
        scored AS (
          SELECT
            a.transaction_name,
            a.scenario_name,
            a.total_count,
            a.passed_count,
            a.failed_count,
            a.avg_response_time,
            ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
            ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
            a.impact_score,
            th.active_threshold,
            ROUND(
              (
                approx_percentile_rank(th.active_threshold::double precision, a.pct_agg)
                + (approx_percentile_rank((th.active_threshold * 4)::double precision, a.pct_agg)
                   - approx_percentile_rank(th.active_threshold::double precision, a.pct_agg)) / 2
              )::numeric,
              3
            ) AS apdex_score
          FROM agg a
          JOIN thresholds th
            ON  th.transaction_name = a.transaction_name
            AND th.scenario_name IS NOT DISTINCT FROM a.scenario_name
        )
        SELECT
          transaction_name,
          scenario_name,
          total_count,
          passed_count,
          failed_count,
          avg_response_time,
          p95_response_time,
          p99_response_time,
          impact_score,
          active_threshold,
          apdex_score,
          RANK() OVER (ORDER BY impact_score DESC) AS ranking
        FROM scored
        ORDER BY transaction_name ASC
      `;

      // Param layout: $1=testRunId, $2=excludeRampUp, $3=cutoffTime,
      //   $4=sinceMinutes (when provided), $5=orgIds (non-admin)
      //   OR $4=orgIds (non-admin, no window)
      let queryParams: unknown[];
      if (sinceMinutes != null) {
        queryParams = !isAdmin
          ? [resolvedTestRunId, excludeRampUp, cutoffTime, sinceMinutes, organizationIds]
          : [resolvedTestRunId, excludeRampUp, cutoffTime, sinceMinutes];
      } else {
        queryParams = !isAdmin
          ? [resolvedTestRunId, excludeRampUp, cutoffTime, organizationIds]
          : [resolvedTestRunId, excludeRampUp, cutoffTime];
      }
      // Wrap in a transaction so SET LOCAL work_mem applies only to this query
      // (reverts at COMMIT — global default unaffected). Manager comes from
      // the request-scoped EM via withRequestEm so this nested transaction
      // (savepoint when RLS is on) inherits the outer request transaction's GUCs.
      const result = await withRequestEm(this.testRunRepo).manager.transaction(async (em) => {
        await em.query(`SET LOCAL work_mem = '512MB'`);
        return em.query(query, queryParams);
      });

      this.logger.log(`Retrieved ${result.length} transaction stats for test run: ${resolvedTestRunId}`);

      return result.map((row: Record<string, unknown>) => ({
        transaction_name: row.transaction_name as string,
        scenario_name: (row.scenario_name as string) || undefined,
        avg_response_time: this.mapper.parseFloat(row.avg_response_time),
        p95_response_time: this.mapper.parseFloat(row.p95_response_time),
        p99_response_time: this.mapper.parseFloat(row.p99_response_time),
        passed_count: this.mapper.parseInt(row.passed_count),
        failed_count: this.mapper.parseInt(row.failed_count),
        total_count: this.mapper.parseInt(row.total_count),
        ranking: this.mapper.parseFloat(row.ranking),
        apdex_score: this.mapper.parseFloat(row.apdex_score),
        active_threshold: this.mapper.parseInt(row.active_threshold, 500),
      }));
    } catch (error) {
      this.logger.error(`Failed to get transaction stats for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve transaction statistics', error);
    }
  }

  /**
   * Get sampler statistics for a specific transaction.
   *
   * Same precision tradeoff as `getTransactionStats`: percentiles and Apdex use
   * the TimescaleDB toolkit tdigest sketch (<1% expected error at p95/p99).
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param transactionName - Transaction name to get samples for
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getTransactionSamples(
    testRunId: string,
    transactionName: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    sinceMinutes?: number,
  ): Promise<SamplerStats[]> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty sampler stats');
        return [];
      }

      this.logger.log(`Getting aggregated sampler stats for transaction: ${transactionName} in test run: ${testRunId}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      // Fast path: rollup (#150, #151). Covers the common case hit by the
      // Overview-tab row expand and the Top 10 Requests tab — exactly the
      // 140s query case captured in #151 for `stream_download_segment`.
      if (sinceMinutes == null) {
        const hasRollup = await this.hasSamplerRollup(resolvedTestRunId, transactionName);
        if (hasRollup) {
          return await this.getTransactionSamplesFromRollup(
            resolvedTestRunId,
            transactionName,
            excludeRampUp,
            isAdmin,
            organizationIds,
          );
        }
      }

      const cutoffTime = await this.getRampUpCutoffTime(resolvedTestRunId, excludeRampUp);

      // Param layout: $1=testRunId, $2=transactionName, $3=excludeRampUp, $4=cutoffTime,
      //   $5=sinceMinutes (when provided), $5 or $6=orgIds (non-admin)
      const windowParamIndexSamples = 5;
      const orgParamIndexSamples = sinceMinutes != null ? 6 : 5;

      const windowFilterSamples = sinceMinutes != null
        ? `AND r.time >= NOW() - ($${windowParamIndexSamples}::numeric * interval '1 minute')`
        : '';

      const orgFilterClause = !isAdmin
        ? `AND sut.organization_id = ANY($${orgParamIndexSamples}::uuid[])`
        : '';

      // Aggregate requests_raw FIRST per (sampler_name, scenario_name, SUT, env)
      // using a percentile_agg tdigest. p95/p99 come from approx_percentile on
      // the sketch; Apdex uses approx_percentile_rank on the same sketch so the
      // threshold join happens exactly once (threshold_config CTE) and is
      // CROSS JOINed onto the post-group result.
      const query = `
        WITH threshold_config AS (
          SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
          FROM test_runs tr
          JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN workload_apdex_thresholds wat
            ON  wat.system_under_test_id = sut.id
            AND wat.test_environment     = tr.test_environment
            AND wat.workload             = tr.workload
          LEFT JOIN workload_transaction_apdex_thresholds wtat
            ON  wtat.system_under_test_id = sut.id
            AND wtat.test_environment     = tr.test_environment
            AND wtat.workload             = tr.workload
            AND wtat.transaction_name     = $2
          WHERE tr.test_run_id = $1
            ${orgFilterClause}
          LIMIT 1
        ),
        agg AS (
          SELECT
            r.sampler_name,
            r.scenario_name,
            r.system_under_test,
            r.test_environment,
            (ARRAY_AGG(r.url_hash ORDER BY r.time DESC) FILTER (WHERE r.url_hash IS NOT NULL))[1] AS url_hash,
            AVG(r.response_time)::numeric(10,2)               AS avg_response_time,
            MIN(r.response_time)                              AS min_response_time,
            MAX(r.response_time)                              AS max_response_time,
            percentile_agg(r.response_time::double precision) AS pct_agg,
            SUM(CASE WHEN r.success THEN 1 ELSE 0 END)        AS passed_count,
            SUM(CASE WHEN NOT r.success THEN 1 ELSE 0 END)    AS failed_count,
            COUNT(*)                                          AS total_count,
            AVG(r.response_latency)::numeric(10,2)            AS avg_latency,
            AVG(r.response_connect_time)::numeric(10,2)       AS avg_connect_time,
            SUM(r.request_size)                               AS total_request_size,
            SUM(r.response_size)                              AS total_response_size
          FROM requests_raw r
          WHERE r.test_run_id = $1
            AND r.transaction_name = $2
            AND ($3::boolean = false OR $4::timestamptz IS NULL OR r.time >= $4::timestamptz)
            ${windowFilterSamples}
          GROUP BY r.sampler_name, r.scenario_name, r.system_under_test, r.test_environment
        )
        SELECT
          a.sampler_name,
          a.scenario_name,
          a.url_hash,
          LOWER(up.normalized_url) AS url_pattern,
          a.avg_response_time,
          a.min_response_time,
          a.max_response_time,
          ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
          ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
          a.passed_count,
          a.failed_count,
          a.total_count,
          a.avg_latency,
          a.avg_connect_time,
          a.total_request_size,
          a.total_response_size,
          tc.active_threshold,
          ROUND(
            (
              approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg)
              + (approx_percentile_rank((tc.active_threshold * 4)::double precision, a.pct_agg)
                 - approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg)) / 2
            )::numeric,
            3
          ) AS apdex_score
        FROM agg a
        CROSS JOIN threshold_config tc
        LEFT JOIN url_patterns up
          ON  a.url_hash         = up.url_hash
          AND a.system_under_test = up.system_under_test
          AND a.test_environment  = up.test_environment
        ORDER BY a.total_count DESC
      `;

      let queryParams: unknown[];
      if (sinceMinutes != null) {
        queryParams = !isAdmin
          ? [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, sinceMinutes, organizationIds]
          : [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, sinceMinutes];
      } else {
        queryParams = !isAdmin
          ? [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, organizationIds]
          : [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime];
      }
      // Wrap in a transaction so SET LOCAL work_mem applies only to this query.
      // Manager comes from the request-scoped EM via withRequestEm so this nested
      // transaction (savepoint when RLS is on) inherits the outer request
      // transaction's GUCs.
      const result = await withRequestEm(this.testRunRepo).manager.transaction(async (em) => {
        await em.query(`SET LOCAL work_mem = '512MB'`);
        return em.query(query, queryParams);
      });

      this.logger.log(`Retrieved ${result.length} aggregated samplers for transaction: ${transactionName}`);

      return result.map((row: Record<string, unknown>) => ({
        sampler_name: row.sampler_name as string,
        scenario_name: (row.scenario_name as string) || undefined,
        avg_response_time: this.mapper.parseFloat(row.avg_response_time),
        min_response_time: this.mapper.parseInt(row.min_response_time),
        max_response_time: this.mapper.parseInt(row.max_response_time),
        p95_response_time: this.mapper.parseFloat(row.p95_response_time),
        p99_response_time: this.mapper.parseFloat(row.p99_response_time),
        passed_count: this.mapper.parseInt(row.passed_count),
        failed_count: this.mapper.parseInt(row.failed_count),
        total_count: this.mapper.parseInt(row.total_count),
        avg_latency: this.mapper.parseFloat(row.avg_latency),
        avg_connect_time: this.mapper.parseFloat(row.avg_connect_time),
        total_request_size: this.mapper.parseInt(row.total_request_size),
        total_response_size: this.mapper.parseInt(row.total_response_size),
        apdex_score: this.mapper.parseFloat(row.apdex_score),
        active_threshold: this.mapper.parseInt(row.active_threshold, 500),
        url_hash: (row.url_hash as string) || null,
        url_pattern: (row.url_pattern as string) || null,
      }));
    } catch (error) {
      this.logger.error(`Failed to get aggregated samplers for transaction ${transactionName}:`, error);
      throw new DatabaseException('Failed to retrieve transaction sampler statistics', error);
    }
  }

  /**
   * Get grouped errors for a transaction or sampler
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param transactionName - Optional transaction name to filter by
   * @param samplerName - Optional sampler name to filter by
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getTransactionErrors(
    testRunId: string,
    transactionName?: string,
    samplerName?: string,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
  ): Promise<ErrorStats[]> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty error stats');
        return [];
      }

      this.logger.log(`Getting errors for test run: ${testRunId}, transaction: ${transactionName || 'all'}, sampler: ${samplerName || 'all'}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      const params: unknown[] = [resolvedTestRunId];
      let paramIndex = 2;

      // Build organization filter clause - parameter index depends on other optional params
      let orgParamIndex = paramIndex;
      if (transactionName) orgParamIndex++;
      if (samplerName) orgParamIndex++;

      const orgFilterClause = !isAdmin
        ? `AND sut.organization_id = ANY($${orgParamIndex}::uuid[])`
        : '';

      let transactionFilter = '';
      if (transactionName) {
        transactionFilter = ` AND re.transaction_name = $${paramIndex}`;
        params.push(transactionName);
        paramIndex++;
      }

      let samplerFilter = '';
      if (samplerName) {
        samplerFilter = ` AND re.sampler_name = $${paramIndex}`;
        params.push(samplerName);
        paramIndex++;
      }

      // Add organization IDs as the last parameter for non-admin users
      if (!isAdmin) {
        params.push(organizationIds);
      }

      // Build threshold_config CTE — reuses $1 (test_run_id) and optionally $2 (transaction_name).
      // When a transaction filter is present ($2 = transactionName), include the per-transaction
      // threshold join so Apdex in the errors modal reflects the configured threshold, not hardcoded 500ms.
      const thresholdTransactionJoin = transactionName
        ? `LEFT JOIN workload_transaction_apdex_thresholds wtat
            ON  wtat.system_under_test_id = sut.id
            AND wtat.test_environment    = tr.test_environment
            AND wtat.workload            = tr.workload
            AND wtat.transaction_name    = $2`
        : '';
      const thresholdCoalesce = transactionName
        ? 'COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500)'
        : 'COALESCE(wat.apdex_threshold, 500)';

      const query = `
        WITH threshold_config AS (
          SELECT ${thresholdCoalesce} as active_threshold
          FROM test_runs tr
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN workload_apdex_thresholds wat
            ON  wat.system_under_test_id = sut.id
            AND wat.test_environment    = tr.test_environment
            AND wat.workload            = tr.workload
          ${thresholdTransactionJoin}
          WHERE tr.test_run_id = $1
          LIMIT 1
        ),
        error_groups AS (
          SELECT
            CASE
              WHEN re.response_code IS NOT NULL THEN CONCAT('HTTP ', re.response_code)
              WHEN re.response_message ~ '^(java\\.|org\\.|com\\.)' THEN REGEXP_REPLACE(re.response_message, '^([^:]+).*', '\\1')
              ELSE 'Other Error'
            END as error_type,
            COALESCE(re.response_code, 'N/A') as response_code,
            COALESCE(SUBSTRING(re.response_message, 1, 200), 'No message') as response_message,
            re.sampler_name,
            re.system_under_test,
            re.test_environment,
            (ARRAY_AGG(re.url_hash ORDER BY re.time DESC) FILTER (WHERE re.url_hash IS NOT NULL))[1] as url_hash,
            SPLIT_PART(COALESCE(re.url, 'N/A'), '?', 1) as normalized_url,
            (ARRAY_AGG(re.url ORDER BY re.time DESC))[1] as sample_url,
            COUNT(*) as count,
            MIN(re.time) as first_occurrence,
            MAX(re.time) as last_occurrence,
            (ARRAY_AGG(re.response_data ORDER BY re.time DESC))[1] as sample_response_data
          FROM requests_error re
          LEFT JOIN test_runs tr ON tr.test_run_id = re.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE re.test_run_id = $1
            ${transactionFilter}
            ${samplerFilter}
            ${orgFilterClause}
          GROUP BY error_type, re.response_code, re.response_message, re.sampler_name, re.system_under_test, re.test_environment, normalized_url, re.url_hash
        ),
        sampler_stats AS (
          SELECT
            rr.sampler_name,
            COUNT(*) as total_count,
            ROUND(
              (
                SUM(CASE WHEN rr.response_time <= tc.active_threshold THEN 1 ELSE 0 END) +
                SUM(CASE WHEN rr.response_time > tc.active_threshold AND rr.response_time <= (tc.active_threshold * 4) THEN 0.5 ELSE 0 END)
              ) / NULLIF(COUNT(*), 0),
              3
            ) as apdex_score
          FROM requests_raw rr
          CROSS JOIN threshold_config tc
          LEFT JOIN test_runs tr ON tr.test_run_id = rr.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE rr.test_run_id = $1
            ${transactionFilter ? transactionFilter.replace('re.', 'rr.') : ''}
            ${samplerFilter ? samplerFilter.replace('re.', 'rr.') : ''}
            ${orgFilterClause}
          GROUP BY rr.sampler_name
        )
        SELECT
          eg.error_type,
          eg.response_code,
          eg.response_message,
          eg.sampler_name,
          LOWER(eg.normalized_url) as url,
          LOWER(eg.sample_url) as sample_url,
          eg.url_hash,
          LOWER(up.normalized_url) as url_pattern,
          eg.count,
          eg.first_occurrence,
          eg.last_occurrence,
          eg.sample_response_data,
          COALESCE(ss.total_count, eg.count) as total_requests,
          COALESCE(ss.apdex_score, 0) as apdex_score
        FROM error_groups eg
        LEFT JOIN sampler_stats ss
          ON eg.sampler_name = ss.sampler_name
        LEFT JOIN url_patterns up
          ON eg.url_hash = up.url_hash
          AND eg.system_under_test = up.system_under_test
          AND eg.test_environment = up.test_environment
        ORDER BY eg.count DESC, eg.last_occurrence DESC
        LIMIT 100
      `;

      const result = await withRequestEm(this.testRunRepo).query(query, params);

      this.logger.log(`Retrieved ${result.length} error groups for test run: ${resolvedTestRunId}`);

      return result.map((row: Record<string, unknown>) => ({
        error_type: row.error_type as string,
        response_code: row.response_code as string,
        response_message: row.response_message as string,
        sampler_name: row.sampler_name as string,
        url: (row.sample_url as string) || (row.url as string),
        url_hash: (row.url_hash as string) || null,
        url_pattern: (row.url_pattern as string) || null,
        count: this.mapper.parseInt(row.count),
        first_occurrence: row.first_occurrence as string,
        last_occurrence: row.last_occurrence as string,
        sample_response_data: (row.sample_response_data as string) || '',
        total_requests: this.mapper.parseInt(row.total_requests),
        apdex_score: this.mapper.parseFloat(row.apdex_score),
      }));
    } catch (error) {
      this.logger.error(`Failed to get errors for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve transaction errors', error);
    }
  }

  /**
   * Get virtual user statistics for a test run
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getVirtualUserStats(
    testRunId: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
  ): Promise<VirtualUserStats> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty virtual user stats');
        return {
          overall: {
            peak_active_threads: 0,
            avg_active_threads: 0,
            peak_started_threads: 0,
            avg_started_threads: 0,
            peak_finished_threads: 0,
            avg_finished_threads: 0,
            total_data_points: 0,
          },
          by_scenario: [],
        };
      }

      this.logger.log(`Getting virtual user stats for test run: ${testRunId} (excludeRampUp: ${excludeRampUp})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      const cutoffTime = await this.getRampUpCutoffTime(resolvedTestRunId, excludeRampUp);

      // Build organization filter clause
      const orgFilterClause = !isAdmin
        ? 'AND sut.organization_id = ANY($4::uuid[])'
        : '';

      const overallQuery = `
        SELECT
          MAX(vu.active_threads) as peak_active_threads,
          AVG(vu.active_threads)::numeric(10,2) as avg_active_threads,
          MAX(vu.started_threads) as peak_started_threads,
          AVG(vu.started_threads)::numeric(10,2) as avg_started_threads,
          MAX(vu.finished_threads) as peak_finished_threads,
          AVG(vu.finished_threads)::numeric(10,2) as avg_finished_threads,
          COUNT(*) as total_data_points
        FROM virtual_users vu
        LEFT JOIN test_runs tr ON tr.test_run_id = vu.test_run_id
        LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN teams team ON team.id = sut.team_id
        WHERE vu.test_run_id = $1
          AND ($2::boolean = false OR $3::timestamptz IS NULL OR vu.time >= $3::timestamptz)
          ${orgFilterClause}
      `;

      const scenarioQuery = `
        SELECT
          vu.scenario_name,
          MAX(vu.active_threads) as peak_active_threads,
          AVG(vu.active_threads)::numeric(10,2) as avg_active_threads,
          MAX(vu.started_threads) as peak_started_threads,
          AVG(vu.started_threads)::numeric(10,2) as avg_started_threads,
          MAX(vu.finished_threads) as peak_finished_threads,
          AVG(vu.finished_threads)::numeric(10,2) as avg_finished_threads,
          COUNT(*) as total_data_points
        FROM virtual_users vu
        LEFT JOIN test_runs tr ON tr.test_run_id = vu.test_run_id
        LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN teams team ON team.id = sut.team_id
        WHERE vu.test_run_id = $1
          AND vu.scenario_name IS NOT NULL
          AND ($2::boolean = false OR $3::timestamptz IS NULL OR vu.time >= $3::timestamptz)
          ${orgFilterClause}
        GROUP BY vu.scenario_name
        ORDER BY vu.scenario_name ASC
      `;

      const queryParams = !isAdmin
        ? [resolvedTestRunId, excludeRampUp, cutoffTime, organizationIds]
        : [resolvedTestRunId, excludeRampUp, cutoffTime];

      const [overallResult, scenarioResult] = await Promise.all([
        withRequestEm(this.testRunRepo).query(overallQuery, queryParams),
        withRequestEm(this.testRunRepo).query(scenarioQuery, queryParams),
      ]);

      this.logger.log(`Retrieved virtual user stats: overall + ${scenarioResult.length} scenarios for test run: ${resolvedTestRunId}`);

      const overall = overallResult[0] || {};

      return {
        overall: {
          peak_active_threads: this.mapper.parseInt(overall.peak_active_threads),
          avg_active_threads: this.mapper.parseFloat(overall.avg_active_threads),
          peak_started_threads: this.mapper.parseInt(overall.peak_started_threads),
          avg_started_threads: this.mapper.parseFloat(overall.avg_started_threads),
          peak_finished_threads: this.mapper.parseInt(overall.peak_finished_threads),
          avg_finished_threads: this.mapper.parseFloat(overall.avg_finished_threads),
          total_data_points: this.mapper.parseInt(overall.total_data_points),
        },
        by_scenario: scenarioResult.map((row: Record<string, unknown>) => ({
          scenario_name: row.scenario_name as string,
          peak_active_threads: this.mapper.parseInt(row.peak_active_threads),
          avg_active_threads: this.mapper.parseFloat(row.avg_active_threads),
          peak_started_threads: this.mapper.parseInt(row.peak_started_threads),
          avg_started_threads: this.mapper.parseFloat(row.avg_started_threads),
          peak_finished_threads: this.mapper.parseInt(row.peak_finished_threads),
          avg_finished_threads: this.mapper.parseFloat(row.avg_finished_threads),
          total_data_points: this.mapper.parseInt(row.total_data_points),
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get virtual user stats for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve virtual user statistics', error);
    }
  }

  /**
   * Get peak throughput per second for transactions and requests
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getThroughputStats(
    testRunId: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
  ): Promise<ThroughputStats> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty throughput stats');
        return {
          overall: {
            peak_transactions_per_second: 0,
            peak_requests_per_second: 0,
          },
          by_scenario: [],
        };
      }

      this.logger.log(`Getting throughput stats for test run: ${testRunId} (excludeRampUp: ${excludeRampUp})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      const cutoffTime = await this.getRampUpCutoffTime(resolvedTestRunId, excludeRampUp);

      // Build organization filter clause
      const orgFilterClause = !isAdmin
        ? 'AND sut.organization_id = ANY($4::uuid[])'
        : '';

      const transactionsQuery = `
        WITH five_second_buckets AS (
          SELECT
            floor(extract(epoch from t.time) / 5) * 5 as time_bucket,
            COUNT(*) as total_count
          FROM transactions t
          LEFT JOIN test_runs tr ON tr.test_run_id = t.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE t.test_run_id = $1
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
            ${orgFilterClause}
          GROUP BY floor(extract(epoch from t.time) / 5)
        )
        SELECT CEIL(MAX(total_count)::numeric / 5) as peak_transactions_per_second
        FROM five_second_buckets
      `;

      const requestsQuery = `
        WITH five_second_buckets AS (
          SELECT
            floor(extract(epoch from rr.time) / 5) * 5 as time_bucket,
            COUNT(*) as total_count
          FROM requests_raw rr
          LEFT JOIN test_runs tr ON tr.test_run_id = rr.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE rr.test_run_id = $1
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR rr.time >= $3::timestamptz)
            ${orgFilterClause}
          GROUP BY floor(extract(epoch from rr.time) / 5)
        )
        SELECT CEIL(MAX(total_count)::numeric / 5) as peak_requests_per_second
        FROM five_second_buckets
      `;

      const scenarioQuery = `
        WITH transaction_buckets AS (
          SELECT
            t.scenario_name,
            floor(extract(epoch from t.time) / 5) as time_bucket,
            COUNT(*) as total_count
          FROM transactions t
          LEFT JOIN test_runs tr ON tr.test_run_id = t.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE t.test_run_id = $1
            AND t.scenario_name IS NOT NULL
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
            ${orgFilterClause}
          GROUP BY t.scenario_name, floor(extract(epoch from t.time) / 5)
        ),
        request_buckets AS (
          SELECT
            rr.scenario_name,
            floor(extract(epoch from rr.time) / 5) as time_bucket,
            COUNT(*) as total_count
          FROM requests_raw rr
          LEFT JOIN test_runs tr ON tr.test_run_id = rr.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE rr.test_run_id = $1
            AND rr.scenario_name IS NOT NULL
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR rr.time >= $3::timestamptz)
            ${orgFilterClause}
          GROUP BY rr.scenario_name, floor(extract(epoch from rr.time) / 5)
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
        )
        SELECT
          COALESCE(t.scenario_name, r.scenario_name) as scenario_name,
          COALESCE(t.peak_transactions_per_second, 0) as peak_transactions_per_second,
          COALESCE(r.peak_requests_per_second, 0) as peak_requests_per_second
        FROM transaction_peaks t
        FULL OUTER JOIN request_peaks r ON t.scenario_name = r.scenario_name
        ORDER BY scenario_name ASC
      `;

      const queryParams = !isAdmin
        ? [resolvedTestRunId, excludeRampUp, cutoffTime, organizationIds]
        : [resolvedTestRunId, excludeRampUp, cutoffTime];

      const [transactionsResult, requestsResult, scenarioResult] = await Promise.all([
        withRequestEm(this.testRunRepo).query(transactionsQuery, queryParams),
        withRequestEm(this.testRunRepo).query(requestsQuery, queryParams),
        withRequestEm(this.testRunRepo).query(scenarioQuery, queryParams),
      ]);

      const transactions = transactionsResult[0] || { peak_transactions_per_second: 0 };
      const requests = requestsResult[0] || { peak_requests_per_second: 0 };

      return {
        overall: {
          peak_transactions_per_second: this.mapper.parseInt(transactions.peak_transactions_per_second),
          peak_requests_per_second: this.mapper.parseInt(requests.peak_requests_per_second),
        },
        by_scenario: scenarioResult.map((row: Record<string, unknown>) => ({
          scenario_name: row.scenario_name as string,
          peak_transactions_per_second: this.mapper.parseInt(row.peak_transactions_per_second),
          peak_requests_per_second: this.mapper.parseInt(row.peak_requests_per_second),
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get throughput stats for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve throughput statistics', error);
    }
  }
}
