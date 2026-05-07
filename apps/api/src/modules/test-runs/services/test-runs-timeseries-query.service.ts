import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { TestRun as TestRunEntity } from '../../../entities';
import { DatabaseException, ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { TimeSeriesDataPoint, TransactionTimeSeriesData } from '../types/test-run.types';
import type { OwnedResource } from '@perfana/shared';

/**
 * Service responsible for time series data queries
 * Handles: getTransactionTimeSeries, getSamplerTimeSeries
 */
@Injectable()
export class TestRunsTimeSeriesQueryService {
  private readonly logger = new Logger(TestRunsTimeSeriesQueryService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly mapper: TestRunsMapperService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Validate that the testRunId belongs to an organization the user has access to.
   * Throws ResourceNotFoundException to hide existence on access denial.
   */
  private async validateOrganizationAccess(
    testRunId: string,
    userId: string,
    roles: string[],
  ): Promise<void> {
    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT sut.organization_id, sut.created_by
       FROM test_runs tr
       INNER JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
       WHERE tr.test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (!result || result.length === 0) {
      throw new ResourceNotFoundException('TestRun', testRunId);
    }

    const accessResult = await this.authzService.canAccessResource(userId, roles, {
      organization_id: result[0].organization_id,
      created_by: result[0].created_by ?? '',
    } as OwnedResource);

    if (!accessResult.allowed) {
      throw new ResourceNotFoundException('TestRun', testRunId);
    }
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
   * Aggregation seconds must be >= 5 and a multiple of 5 — the CAGG floor is
   * the 5 s `bucket` column on `requests_raw_5s` / `transactions_5s`.
   */
  private validateAggregationSeconds(aggregationSeconds: number): void {
    if (
      !Number.isFinite(aggregationSeconds) ||
      !Number.isInteger(aggregationSeconds) ||
      aggregationSeconds < 5 ||
      aggregationSeconds % 5 !== 0
    ) {
      throw new BadRequestException(
        `aggregationSeconds must be an integer >= 5 and a multiple of 5 (got ${aggregationSeconds})`,
      );
    }
  }

  /**
   * Build the parameterized SQL for a time-series query against the 5 s CAGG.
   * One source of truth for the three call shapes used by this service.
   *
   * Kinds:
   *   - 'transaction'      → group by 5 s bucket, read from transactions_5s
   *   - 'sampler'          → group by 5 s bucket + sampler_name, read from requests_raw_5s
   *   - 'sampler-single'   → group by 5 s bucket only, filter sampler_name = $3,
   *                          read from requests_raw_5s
   *
   * Parameters expected by the returned SQL:
   *   $1 = test_run_id
   *   $2 = transaction_name
   *   for transaction & sampler kinds:
   *     $3 = excludeRampUp (boolean)
   *     $4 = ramp-up cutoff (timestamptz | null)
   *   for sampler-single kind:
   *     $3 = sampler_name
   *     $4 = excludeRampUp (boolean)
   *     $5 = ramp-up cutoff (timestamptz | null)
   */
  private buildTimeSeriesQuery(opts: {
    kind: 'transaction' | 'sampler' | 'sampler-single';
    aggSec: number;
  }): string {
    const { kind, aggSec } = opts;
    const sourceView = kind === 'transaction' ? 'transactions_5s' : 'requests_raw_5s';
    const isSamplerSingle = kind === 'sampler-single';
    const isSamplerGroup = kind === 'sampler';

    const excludeRampParam = isSamplerSingle ? '$4' : '$3';
    const cutoffParam = isSamplerSingle ? '$5' : '$4';
    const samplerSinglePredicate = isSamplerSingle ? 'AND c.sampler_name = $3' : '';
    const samplerGroupSelect = isSamplerGroup ? 'c.sampler_name AS sampler_name,' : '';
    const samplerGroupKey = isSamplerGroup ? ', c.sampler_name' : '';

    return `
      WITH run AS (
        SELECT sut.name AS sut,
               tr.test_environment AS env,
               tr.start_time,
               tr.end_time
        FROM test_runs tr
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE tr.test_run_id = $1
      ),
      scenarios AS (
        SELECT DISTINCT scenario_name
        FROM transactions
        WHERE test_run_id = $1 AND transaction_name = $2
      ),
      bounds AS (
        SELECT CASE WHEN ${excludeRampParam}::boolean
                    THEN GREATEST(start_time, ${cutoffParam}::timestamptz)
                    ELSE start_time END AS start_time,
               end_time
        FROM run
      ),
      time_series AS (
        SELECT ${isSamplerGroup ? 'sl.sampler_name,' : ''}
               generate_series(
                 time_bucket('${aggSec} seconds'::interval, b.start_time),
                 time_bucket('${aggSec} seconds'::interval, b.end_time),
                 interval '${aggSec} seconds'
               ) AS time_bucket
        FROM bounds b
        ${
          isSamplerGroup
            ? `CROSS JOIN (
                 SELECT DISTINCT sampler_name
                 FROM requests_raw_5s c
                 JOIN run r
                   ON c.system_under_test = r.sut
                  AND c.test_environment  = r.env
                 WHERE c.transaction_name = $2
                   AND c.scenario_name IN (SELECT scenario_name FROM scenarios)
                   AND c.bucket >= (SELECT start_time FROM bounds)
                   AND c.bucket <  (SELECT end_time   FROM bounds) + interval '5 seconds'
               ) sl`
            : ''
        }
      ),
      agg AS (
        SELECT
          ${samplerGroupSelect}
          time_bucket('${aggSec} seconds'::interval, c.bucket) AS time_bucket,
          (sum(c.avg_rt * c.n) / NULLIF(sum(c.n), 0))::numeric(10,2) AS avg_response_time,
          approx_percentile(0.50, rollup(c.pct_agg))::numeric(10,2) AS median_response_time,
          min(c.min_rt) AS min_response_time,
          max(c.max_rt) AS max_response_time,
          approx_percentile(0.90, rollup(c.pct_agg))::numeric(10,2) AS p90_response_time,
          approx_percentile(0.95, rollup(c.pct_agg))::numeric(10,2) AS p95_response_time,
          approx_percentile(0.99, rollup(c.pct_agg))::numeric(10,2) AS p99_response_time,
          sum(c.n)::bigint    AS total_count,
          sum(c.n_ok)::bigint AS passed_count,
          sum(c.n_err)::bigint AS failed_count
        FROM ${sourceView} c
        JOIN run r
          ON c.system_under_test = r.sut
         AND c.test_environment  = r.env
        WHERE c.transaction_name = $2
          ${samplerSinglePredicate}
          AND c.scenario_name IN (SELECT scenario_name FROM scenarios)
          AND c.bucket >= (SELECT start_time FROM bounds)
          AND c.bucket <  (SELECT end_time   FROM bounds) + interval '5 seconds'
          AND (${excludeRampParam}::boolean = false OR ${cutoffParam}::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds', ${cutoffParam}::timestamptz))
        GROUP BY time_bucket('${aggSec} seconds'::interval, c.bucket)${samplerGroupKey}
      )
      SELECT ${isSamplerGroup ? 'ts.sampler_name,' : ''}
             ts.time_bucket,
             a.avg_response_time, a.median_response_time,
             a.min_response_time, a.max_response_time,
             a.p90_response_time, a.p95_response_time, a.p99_response_time,
             COALESCE(a.total_count, 0)  AS total_count,
             COALESCE(a.passed_count, 0) AS passed_count,
             COALESCE(a.failed_count, 0) AS failed_count
      FROM time_series ts
      LEFT JOIN agg a ON a.time_bucket = ts.time_bucket
        ${isSamplerGroup ? 'AND a.sampler_name = ts.sampler_name' : ''}
      ORDER BY ${isSamplerGroup ? 'ts.sampler_name, ' : ''}ts.time_bucket ASC
    `;
  }

  /**
   * Parse time series row to data point
   */
  private parseTimeSeriesRow(row: Record<string, unknown>): TimeSeriesDataPoint {
    return {
      time_bucket: row.time_bucket as string,
      avg_response_time: row.avg_response_time === null ? null as unknown as number : this.mapper.parseFloat(row.avg_response_time),
      median_response_time: row.median_response_time === null ? null as unknown as number : this.mapper.parseFloat(row.median_response_time),
      min_response_time: row.min_response_time === null ? null as unknown as number : this.mapper.parseInt(row.min_response_time),
      max_response_time: row.max_response_time === null ? null as unknown as number : this.mapper.parseInt(row.max_response_time),
      p90_response_time: row.p90_response_time === null ? null as unknown as number : this.mapper.parseFloat(row.p90_response_time),
      p95_response_time: row.p95_response_time === null ? null as unknown as number : this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: row.p99_response_time === null ? null as unknown as number : this.mapper.parseFloat(row.p99_response_time),
      total_count: this.mapper.parseInt(row.total_count),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
    };
  }

  /**
   * Get time-series data for a transaction with configurable aggregation
   *
   * @param testRunId - The test run ID to query
   * @param transactionName - The transaction name to filter by
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   * @param aggregationSeconds - Aggregation bucket size in seconds
   * @param excludeRampUp - Whether to exclude ramp-up period from results
   */
  async getTransactionTimeSeries(
    testRunId: string,
    transactionName: string,
    userId: string,
    roles: string[],
    aggregationSeconds: number = 5,
    excludeRampUp: boolean = false,
  ): Promise<TransactionTimeSeriesData> {
    try {
      this.validateAggregationSeconds(aggregationSeconds);
      await this.validateOrganizationAccess(testRunId, userId, roles);

      this.logger.log(
        `Getting time-series data for transaction: ${transactionName} with ${aggregationSeconds}s aggregation (excludeRampUp: ${excludeRampUp})`,
      );

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);
      const queryParams = [testRunId, transactionName, excludeRampUp, cutoffTime ?? null];

      const transactionQuery = this.buildTimeSeriesQuery({
        kind: 'transaction',
        aggSec: aggregationSeconds,
      });
      const transactionResult = await withRequestEm(this.testRunRepo).query(
        transactionQuery,
        queryParams,
      );

      const samplerQuery = this.buildTimeSeriesQuery({
        kind: 'sampler',
        aggSec: aggregationSeconds,
      });
      const samplerResult = await withRequestEm(this.testRunRepo).query(
        samplerQuery,
        queryParams,
      );

      const samplerData: Record<string, TimeSeriesDataPoint[]> = {};
      for (const row of samplerResult as Record<string, unknown>[]) {
        const samplerName = row.sampler_name as string;
        if (!samplerData[samplerName]) {
          samplerData[samplerName] = [];
        }
        samplerData[samplerName]!.push(this.parseTimeSeriesRow(row));
      }

      this.logger.log(
        `Retrieved ${transactionResult.length} transaction data points and ${Object.keys(samplerData).length} samplers`,
      );

      return {
        transaction_data: transactionResult.map((row: Record<string, unknown>) =>
          this.parseTimeSeriesRow(row),
        ),
        sampler_data: samplerData,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to get time-series data for transaction ${transactionName}:`,
        error,
      );
      throw new DatabaseException(
        'Failed to retrieve transaction time-series data',
        error,
      );
    }
  }

  /**
   * Get time-series data for a specific sampler/request within a transaction
   *
   * @param testRunId - The test run ID to query
   * @param transactionName - The transaction name to filter by
   * @param samplerName - The sampler name to filter by
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   * @param aggregationSeconds - Aggregation bucket size in seconds
   * @param excludeRampUp - Whether to exclude ramp-up period from results
   */
  async getSamplerTimeSeries(
    testRunId: string,
    transactionName: string,
    samplerName: string,
    userId: string,
    roles: string[],
    aggregationSeconds: number = 5,
    excludeRampUp: boolean = false,
  ): Promise<TimeSeriesDataPoint[]> {
    try {
      this.validateAggregationSeconds(aggregationSeconds);
      await this.validateOrganizationAccess(testRunId, userId, roles);

      this.logger.log(
        `Getting time-series data for sampler: ${samplerName} in transaction: ${transactionName} with ${aggregationSeconds}s aggregation (excludeRampUp: ${excludeRampUp})`,
      );

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);
      const queryParams = [
        testRunId,
        transactionName,
        samplerName,
        excludeRampUp,
        cutoffTime ?? null,
      ];

      const samplerQuery = this.buildTimeSeriesQuery({
        kind: 'sampler-single',
        aggSec: aggregationSeconds,
      });
      const samplerResult = await withRequestEm(this.testRunRepo).query(
        samplerQuery,
        queryParams,
      );

      this.logger.log(
        `Retrieved ${samplerResult.length} data points for sampler ${samplerName}`,
      );

      return samplerResult.map((row: Record<string, unknown>) =>
        this.parseTimeSeriesRow(row),
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to get time-series data for sampler ${samplerName}:`,
        error,
      );
      throw new DatabaseException(
        'Failed to retrieve sampler time-series data',
        error,
      );
    }
  }
}
