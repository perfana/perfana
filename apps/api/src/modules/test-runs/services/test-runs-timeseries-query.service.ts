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
   * Bucket sizes the server will pick on its own. All are multiples of 5 (the
   * CAGG floor) so `validateAggregationSeconds` accepts every one of them.
   * A caller may still ask for any other legal multiple of 5 explicitly.
   */
  private static readonly AGGREGATION_LADDER = [5, 10, 15, 20, 30, 60, 120, 180, 300];

  /** Points per series to aim for when the server picks the bucket size. */
  private static readonly TARGET_BUCKETS = 360;

  /**
   * Pick a bucket size from the run's duration.
   *
   * At the 5 s floor a 3 h run is 2160 buckets per series — six points per
   * screen pixel, and a response that grows linearly with a number nobody can
   * see. Aiming at ~360 points keeps the chart at roughly one point per pixel
   * and keeps a long run's payload flat instead of proportional to duration.
   *
   * The rungs are spaced so no step drops resolution by more than 2x. A sparser
   * ladder puts a cliff at every rung boundary: with [5,10,30,60,300] a run one
   * second past 6 h fell from 360 points to 72, and one second past 1 h from
   * 360 to 120. A test does not get meaningfully less readable for lasting a
   * second longer.
   *
   * Falls back to the floor when the run has no usable end_time (still running,
   * or aborted). That run charts empty either way — `bounds.end_time` is NULL,
   * so both generate_series and the agg window yield nothing — so the fallback
   * only keeps this from throwing; it does not rescue the chart.
   */
  private async resolveAggregationSeconds(testRunId: string): Promise<number> {
    const ladder = TestRunsTimeSeriesQueryService.AGGREGATION_LADDER;
    const floor = ladder[0]!;

    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT EXTRACT(EPOCH FROM (end_time - start_time)) AS seconds
       FROM test_runs WHERE test_run_id = $1`,
      [testRunId],
    );

    const seconds = Number(result?.[0]?.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return floor;

    const wanted = seconds / TestRunsTimeSeriesQueryService.TARGET_BUCKETS;
    // Snap up: the coarsest rung is the cap for a very long run.
    return ladder.find((step) => step >= wanted) ?? ladder[ladder.length - 1]!;
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
   * The single-series kinds pad against a generate_series grid so an idle bucket
   * plots as a real zero on the throughput trace. The 'sampler' kind deliberately
   * does NOT: it is a Plotly stacked area (stackgroup, stackgaps 'infer zero'),
   * which fills the gaps client-side. Padding it costs buckets × samplers rows —
   * a 3 h run with 19 samplers returned 41 420 rows of which 560 held data, an
   * 11.8 MB response instead of 173 KB. Do not "restore" the LEFT JOIN here.
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
        SELECT generate_series(
                 time_bucket('${aggSec} seconds'::interval, b.start_time),
                 time_bucket('${aggSec} seconds'::interval, b.end_time),
                 interval '${aggSec} seconds'
               ) AS time_bucket
        FROM bounds b
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
      ${
        isSamplerGroup
          ? `SELECT sampler_name, time_bucket,
                    avg_response_time, median_response_time,
                    min_response_time, max_response_time,
                    p90_response_time, p95_response_time, p99_response_time,
                    total_count, passed_count, failed_count
             FROM agg
             ORDER BY sampler_name, time_bucket ASC`
          : `SELECT ts.time_bucket,
                    a.avg_response_time, a.median_response_time,
                    a.min_response_time, a.max_response_time,
                    a.p90_response_time, a.p95_response_time, a.p99_response_time,
                    COALESCE(a.total_count, 0)  AS total_count,
                    COALESCE(a.passed_count, 0) AS passed_count,
                    COALESCE(a.failed_count, 0) AS failed_count
             FROM time_series ts
             LEFT JOIN agg a ON a.time_bucket = ts.time_bucket
             ORDER BY ts.time_bucket ASC`
      }
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
   * @param aggregationSeconds - Aggregation bucket size in seconds. Omit to let
   *   the server pick one from the run duration; the choice is echoed back as
   *   `aggregation_seconds`.
   * @param excludeRampUp - Whether to exclude ramp-up period from results
   */
  async getTransactionTimeSeries(
    testRunId: string,
    transactionName: string,
    userId: string,
    roles: string[],
    aggregationSeconds?: number,
    excludeRampUp: boolean = false,
  ): Promise<TransactionTimeSeriesData> {
    try {
      if (aggregationSeconds !== undefined) this.validateAggregationSeconds(aggregationSeconds);
      await this.validateOrganizationAccess(testRunId, userId, roles);

      // Resolve after the access check — an unauthorized caller must not be
      // able to probe run durations.
      const aggSec = aggregationSeconds ?? (await this.resolveAggregationSeconds(testRunId));

      this.logger.log(
        `Getting time-series data for transaction: ${transactionName} with ${aggSec}s aggregation (${aggregationSeconds === undefined ? 'server-picked from run duration' : 'caller-supplied'}, excludeRampUp: ${excludeRampUp})`,
      );

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);
      const queryParams = [testRunId, transactionName, excludeRampUp, cutoffTime ?? null];

      const transactionQuery = this.buildTimeSeriesQuery({
        kind: 'transaction',
        aggSec,
      });
      const transactionResult = await withRequestEm(this.testRunRepo).query(
        transactionQuery,
        queryParams,
      );

      const samplerQuery = this.buildTimeSeriesQuery({
        kind: 'sampler',
        aggSec,
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
        aggregation_seconds: aggSec,
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
