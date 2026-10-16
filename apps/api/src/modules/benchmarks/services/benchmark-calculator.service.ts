import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  TEST_RUN_TIMES_SQL,
  analysisBoundsFromRow,
  snapBoundsToChunks,
  timeBoundsSql,
} from '@perfana/shared/database/run-window';

/**
 * Result of an Apdex calculation preview
 */
export interface ApdexPreviewResult {
  transaction_name: string | null;
  satisfied_count: number;
  tolerating_count: number;
  frustrated_count: number;
  total_count: number;
  apdex_score: number | null;
  threshold_ms: number;
}

/**
 * Apdex threshold configuration with source information
 */
export interface ApdexThresholdResult {
  threshold_ms: number;
  source: 'transaction' | 'workload' | 'default';
}

/**
 * Parameters for Apdex preview calculation
 */
export interface ApdexPreviewParams {
  testRunId: string;
  transactionName?: string;
  thresholdMs: number;
  includeFailedRequests?: boolean;
  excludeRampUp?: boolean;
}

/**
 * Parameters for retrieving Apdex threshold
 */
export interface ApdexThresholdParams {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  transactionName?: string;
}

/**
 * Service responsible for benchmark calculations
 * Handles: Apdex score calculation, threshold retrieval, and related computations
 */
@Injectable()
export class BenchmarkCalculatorService {
  private readonly logger = new Logger(BenchmarkCalculatorService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get available transactions for a test run (for Apdex SLO configuration UI)
   */
  async getAvailableTransactions(testRunId: string): Promise<string[]> {
    try {
      // Bounded, or this locks every chunk of `requests_raw` — see
      // @perfana/shared/database/run-window.
      const runRows = await this.dataSource.query(TEST_RUN_TIMES_SQL, [testRunId]);
      // Whole-run aggregate: widen to the chunk boundary so the planner can drop the
      // qual on a fully covered chunk. Restores the ~1.9x buffer cost a plain bound adds
      // to a scan like this (8,513 vs 16,186 on a 2.5 M-row run) for one ~3 ms catalog
      // lookup, cached per table. Selective reads must NOT do this — 3 ms dwarfs them.
      const time = timeBoundsSql(
        await snapBoundsToChunks(
          (sql, p) => this.dataSource.query(sql, p), 'requests_raw',
          analysisBoundsFromRow(runRows?.[0], false)),
        'time', 2);
      const result = await this.dataSource.query(`
        SELECT DISTINCT transaction_name
        FROM requests_raw
        WHERE test_run_id = $1
          AND transaction_name IS NOT NULL
          ${time.clause}
        ORDER BY transaction_name
      `, [testRunId, ...time.params]);

      return result.map((row: { transaction_name: string }) => row.transaction_name);
    } catch (error) {
      this.logger.error(`Failed to get transactions for test run ${testRunId}:`, error);
      throw error;
    }
  }

  /**
   * Preview Apdex calculation for a test run (for Apdex SLO configuration UI)
   *
   * Apdex (Application Performance Index) formula:
   * Apdex = (Satisfied + Tolerating * 0.5) / Total
   *
   * Where:
   * - Satisfied: response_time <= threshold
   * - Tolerating: threshold < response_time <= 4 * threshold
   * - Frustrated: response_time > 4 * threshold
   */
  async previewApdex(params: ApdexPreviewParams): Promise<ApdexPreviewResult> {
    try {
      const {
        testRunId,
        transactionName,
        thresholdMs,
        includeFailedRequests = false,
        excludeRampUp = true,
      } = params;

      // First get test run info for ramp-up exclusion
      const testRunResult = await this.dataSource.query(TEST_RUN_TIMES_SQL, [testRunId]);

      if (testRunResult.length === 0) {
        throw new Error(`Test run not found: ${testRunId}`);
      }

      const toleratingThreshold = thresholdMs * 4;

      // Build WHERE clause
      const conditions: string[] = ['test_run_id = $1'];
      const queryParams: unknown[] = [testRunId];
      let paramIndex = 2;

      // Filter by transaction if specified
      if (transactionName) {
        conditions.push(`transaction_name = $${paramIndex}`);
        queryParams.push(transactionName);
        paramIndex++;
      }

      // Exclude failed requests unless configured otherwise
      if (!includeFailedRequests) {
        conditions.push('success = true');
      }

      // The window: the analysis timerange when excludeRampUp is set, the run's own
      // padded window otherwise. Never absent — an unbounded read on this table locks
      // every chunk of it. See @perfana/shared/database/run-window.
      const bounds = timeBoundsSql(
        analysisBoundsFromRow(testRunResult[0], excludeRampUp), 'time', paramIndex);
      if (bounds.clause) {
        conditions.push(bounds.clause.replace(/^AND /, ''));
        queryParams.push(...bounds.params);
        paramIndex = bounds.nextIndex;
      }

      const whereClause = conditions.join(' AND ');

      // Add threshold params
      queryParams.push(thresholdMs);
      queryParams.push(toleratingThreshold);

      const query = `
        SELECT
          COUNT(*) FILTER (WHERE response_time <= $${paramIndex}) as satisfied_count,
          COUNT(*) FILTER (WHERE response_time > $${paramIndex} AND response_time <= $${paramIndex + 1}) as tolerating_count,
          COUNT(*) FILTER (WHERE response_time > $${paramIndex + 1}) as frustrated_count,
          COUNT(*) as total_count
        FROM requests_raw
        WHERE ${whereClause}
          AND response_time IS NOT NULL
      `;

      const result = await this.dataSource.query(query, queryParams);
      const row = result[0];

      const satisfied = parseInt(row.satisfied_count) || 0;
      const tolerating = parseInt(row.tolerating_count) || 0;
      const frustrated = parseInt(row.frustrated_count) || 0;
      const total = parseInt(row.total_count) || 0;

      // Calculate Apdex score: (Satisfied + Tolerating * 0.5) / Total
      const apdexScore = total > 0
        ? Math.round(((satisfied + tolerating * 0.5) / total) * 1000) / 1000
        : null;

      this.logger.debug(
        `Apdex preview for ${transactionName || 'workload'}: ${apdexScore?.toFixed(3) || 'N/A'} ` +
        `(S:${satisfied} T:${tolerating} F:${frustrated} Total:${total})`
      );

      return {
        transaction_name: transactionName || null,
        satisfied_count: satisfied,
        tolerating_count: tolerating,
        frustrated_count: frustrated,
        total_count: total,
        apdex_score: apdexScore,
        threshold_ms: thresholdMs,
      };
    } catch (error) {
      this.logger.error('Failed to preview Apdex:', error);
      throw error;
    }
  }

  /**
   * Get configured Apdex threshold for a transaction/workload
   * Falls back through: transaction-specific → workload-level → default (500ms)
   */
  async getApdexThreshold(params: ApdexThresholdParams): Promise<ApdexThresholdResult> {
    try {
      const { systemUnderTestId, testEnvironment, workload, transactionName } = params;

      // 1. Try transaction-specific threshold
      if (transactionName) {
        const transactionResult = await this.dataSource.query(`
          SELECT apdex_threshold
          FROM workload_transaction_apdex_thresholds
          WHERE system_under_test_id = $1
            AND test_environment = $2
            AND workload = $3
            AND transaction_name = $4
        `, [systemUnderTestId, testEnvironment, workload, transactionName]);

        if (transactionResult.length > 0 && transactionResult[0].apdex_threshold) {
          return {
            threshold_ms: transactionResult[0].apdex_threshold,
            source: 'transaction',
          };
        }
      }

      // 2. Try workload-level threshold
      const workloadResult = await this.dataSource.query(`
        SELECT apdex_threshold
        FROM workload_apdex_thresholds
        WHERE system_under_test_id = $1
          AND test_environment = $2
          AND workload = $3
      `, [systemUnderTestId, testEnvironment, workload]);

      if (workloadResult.length > 0 && workloadResult[0].apdex_threshold) {
        return {
          threshold_ms: workloadResult[0].apdex_threshold,
          source: 'workload',
        };
      }

      // 3. Default
      return {
        threshold_ms: 500,
        source: 'default',
      };
    } catch (error) {
      this.logger.error('Failed to get Apdex threshold:', error);
      throw error;
    }
  }
}
