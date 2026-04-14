import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { DatabaseException, ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TimeSeriesDataPoint, TransactionTimeSeriesData } from '../types/test-run.types';

/**
 * Global admin roles that bypass organization filtering
 */
const ADMIN_ROLES = ['perfana-admin', 'super-admin', 'admin'];

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
  ) {}

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return roles.some(role => ADMIN_ROLES.includes(role));
  }

  /**
   * Validate that the testRunId belongs to an organization the user has access to.
   * Returns the test run if access is allowed, otherwise throws ResourceNotFoundException.
   */
  private async validateOrganizationAccess(
    testRunId: string,
    roles: string[],
    organizationIds: string[],
  ): Promise<void> {
    const isAdmin = this.isGlobalAdmin(roles);

    // Admin users bypass organization filtering
    if (isAdmin) {
      return;
    }

    // Non-admin users with no organization memberships cannot access any data
    if (organizationIds.length === 0) {
      throw new ResourceNotFoundException('TestRun', testRunId);
    }

    // Query test run with organization filter through system_under_test
    const testRun = await this.testRunRepo
      .createQueryBuilder('tr')
      .leftJoin('tr.systemUnderTest', 'sut')
      .where('tr.testRunId = :testRunId', { testRunId })
      .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds })
      .select(['tr.id'])
      .getOne();

    if (!testRun) {
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
    const result = await this.testRunRepo.query(query, [testRunId]);

    if (result[0]?.start_time && result[0]?.ramp_up) {
      const startTime = new Date(result[0].start_time);
      const analysisStartOffsetSeconds = this.mapper.parseInt(result[0].ramp_up);
      return new Date(startTime.getTime() + analysisStartOffsetSeconds * 1000);
    }

    return null;
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
   * @param aggregationSeconds - Aggregation bucket size in seconds
   * @param excludeRampUp - Whether to exclude ramp-up period from results
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async getTransactionTimeSeries(
    testRunId: string,
    transactionName: string,
    aggregationSeconds: number = 1,
    excludeRampUp: boolean = false,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<TransactionTimeSeriesData> {
    try {
      // Validate organization access before processing
      await this.validateOrganizationAccess(testRunId, roles, organizationIds);

      this.logger.log(`Getting time-series data for transaction: ${transactionName} with ${aggregationSeconds}s aggregation (excludeRampUp: ${excludeRampUp})`);

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);

      // Query for transaction-level aggregated data with complete time series (zero-filled gaps)
      const transactionQuery = `
        WITH test_run_bounds AS (
          SELECT
            CASE
              WHEN $3::boolean = true THEN GREATEST(MIN(time), $4::timestamptz)
              ELSE MIN(time)
            END as start_time,
            MAX(time) as end_time
          FROM transactions
          WHERE test_run_id = $1
            AND transaction_name = $2
        ),
        time_series AS (
          SELECT generate_series(
            time_bucket('${aggregationSeconds} seconds', start_time),
            time_bucket('${aggregationSeconds} seconds', end_time),
            interval '${aggregationSeconds} seconds'
          ) as time_bucket
          FROM test_run_bounds
        ),
        aggregated_data AS (
          SELECT
            time_bucket('${aggregationSeconds} seconds', time) as time_bucket,
            AVG(response_time)::numeric(10,2) as avg_response_time,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as median_response_time,
            MIN(response_time) as min_response_time,
            MAX(response_time) as max_response_time,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p90_response_time,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p95_response_time,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p99_response_time,
            COUNT(*) as total_count,
            COUNT(*) FILTER (WHERE success = true) as passed_count,
            COUNT(*) FILTER (WHERE success = false) as failed_count
          FROM transactions
          WHERE test_run_id = $1
            AND transaction_name = $2
            AND ($3::boolean = false OR $4::timestamptz IS NULL OR time >= $4::timestamptz)
          GROUP BY time_bucket
        )
        SELECT
          ts.time_bucket,
          ad.avg_response_time,
          ad.median_response_time,
          ad.min_response_time,
          ad.max_response_time,
          ad.p90_response_time,
          ad.p95_response_time,
          ad.p99_response_time,
          COALESCE(ad.total_count, 0) as total_count,
          COALESCE(ad.passed_count, 0) as passed_count,
          COALESCE(ad.failed_count, 0) as failed_count
        FROM time_series ts
        LEFT JOIN aggregated_data ad ON ts.time_bucket = ad.time_bucket
        ORDER BY ts.time_bucket ASC
      `;

      const queryParams = cutoffTime
        ? [testRunId, transactionName, excludeRampUp, cutoffTime]
        : [testRunId, transactionName, excludeRampUp, null];
      const transactionResult = await this.testRunRepo.query(transactionQuery, queryParams);

      // Query for sampler-level aggregated data with complete time series
      const samplerQuery = `
        WITH test_run_bounds AS (
          SELECT
            CASE
              WHEN $3::boolean = true THEN GREATEST(MIN(time), $4::timestamptz)
              ELSE MIN(time)
            END as start_time,
            MAX(time) as end_time
          FROM requests_raw
          WHERE test_run_id = $1
            AND transaction_name = $2
        ),
        sampler_list AS (
          SELECT DISTINCT sampler_name
          FROM requests_raw
          WHERE test_run_id = $1
            AND transaction_name = $2
        ),
        time_series AS (
          SELECT
            sl.sampler_name,
            generate_series(
              time_bucket('${aggregationSeconds} seconds', trb.start_time),
              time_bucket('${aggregationSeconds} seconds', trb.end_time),
              interval '${aggregationSeconds} seconds'
            ) as time_bucket
          FROM sampler_list sl
          CROSS JOIN test_run_bounds trb
        ),
        aggregated_data AS (
          SELECT
            sampler_name,
            time_bucket('${aggregationSeconds} seconds', time) as time_bucket,
            AVG(response_time)::numeric(10,2) as avg_response_time,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as median_response_time,
            MIN(response_time) as min_response_time,
            MAX(response_time) as max_response_time,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p90_response_time,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p95_response_time,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p99_response_time,
            COUNT(*) as total_count,
            COUNT(*) FILTER (WHERE success = true) as passed_count,
            COUNT(*) FILTER (WHERE success = false) as failed_count
          FROM requests_raw
          WHERE test_run_id = $1
            AND transaction_name = $2
            AND ($3::boolean = false OR $4::timestamptz IS NULL OR time >= $4::timestamptz)
          GROUP BY sampler_name, time_bucket
        )
        SELECT
          ts.sampler_name,
          ts.time_bucket,
          ad.avg_response_time,
          ad.median_response_time,
          ad.min_response_time,
          ad.max_response_time,
          ad.p90_response_time,
          ad.p95_response_time,
          ad.p99_response_time,
          COALESCE(ad.total_count, 0) as total_count,
          COALESCE(ad.passed_count, 0) as passed_count,
          COALESCE(ad.failed_count, 0) as failed_count
        FROM time_series ts
        LEFT JOIN aggregated_data ad ON ts.sampler_name = ad.sampler_name AND ts.time_bucket = ad.time_bucket
        ORDER BY ts.sampler_name, ts.time_bucket ASC
      `;

      const samplerResult = await this.testRunRepo.query(samplerQuery, queryParams);

      // Group sampler data by sampler_name
      const samplerData: Record<string, TimeSeriesDataPoint[]> = {};
      for (const row of samplerResult as Record<string, unknown>[]) {
        const samplerName = row.sampler_name as string;
        if (!samplerData[samplerName]) {
          samplerData[samplerName] = [];
        }
        samplerData[samplerName]!.push(this.parseTimeSeriesRow(row));
      }

      this.logger.log(`Retrieved ${transactionResult.length} transaction data points and ${Object.keys(samplerData).length} samplers`);

      return {
        transaction_data: transactionResult.map((row: Record<string, unknown>) => this.parseTimeSeriesRow(row)),
        sampler_data: samplerData,
      };
    } catch (error) {
      this.logger.error(`Failed to get time-series data for transaction ${transactionName}:`, error);
      throw new DatabaseException('Failed to retrieve transaction time-series data', error);
    }
  }

  /**
   * Get time-series data for a specific sampler/request within a transaction
   *
   * @param testRunId - The test run ID to query
   * @param transactionName - The transaction name to filter by
   * @param samplerName - The sampler name to filter by
   * @param aggregationSeconds - Aggregation bucket size in seconds
   * @param excludeRampUp - Whether to exclude ramp-up period from results
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async getSamplerTimeSeries(
    testRunId: string,
    transactionName: string,
    samplerName: string,
    aggregationSeconds: number = 5,
    excludeRampUp: boolean = false,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<TimeSeriesDataPoint[]> {
    try {
      // Validate organization access before processing
      await this.validateOrganizationAccess(testRunId, roles, organizationIds);

      this.logger.log(`Getting time-series data for sampler: ${samplerName} in transaction: ${transactionName} with ${aggregationSeconds}s aggregation (excludeRampUp: ${excludeRampUp})`);

      const cutoffTime = await this.getRampUpCutoffTime(testRunId, excludeRampUp);

      const samplerQuery = `
        WITH test_run_bounds AS (
          SELECT
            CASE
              WHEN $4::boolean = true THEN GREATEST(MIN(time), $5::timestamptz)
              ELSE MIN(time)
            END as start_time,
            MAX(time) as end_time
          FROM requests_raw
          WHERE test_run_id = $1
            AND transaction_name = $2
            AND sampler_name = $3
        ),
        time_series AS (
          SELECT generate_series(
            time_bucket('${aggregationSeconds} seconds', start_time),
            time_bucket('${aggregationSeconds} seconds', end_time),
            interval '${aggregationSeconds} seconds'
          ) as time_bucket
          FROM test_run_bounds
        ),
        aggregated_data AS (
          SELECT
            time_bucket('${aggregationSeconds} seconds', time) as time_bucket,
            AVG(response_time)::numeric(10,2) as avg_response_time,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as median_response_time,
            MIN(response_time) as min_response_time,
            MAX(response_time) as max_response_time,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p90_response_time,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p95_response_time,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time)::numeric(10,2) as p99_response_time,
            COUNT(*) as total_count,
            COUNT(*) FILTER (WHERE success = true) as passed_count,
            COUNT(*) FILTER (WHERE success = false) as failed_count
          FROM requests_raw
          WHERE test_run_id = $1
            AND transaction_name = $2
            AND sampler_name = $3
            AND ($4::boolean = false OR $5::timestamptz IS NULL OR time >= $5::timestamptz)
          GROUP BY time_bucket
        )
        SELECT
          ts.time_bucket,
          ad.avg_response_time,
          ad.median_response_time,
          ad.min_response_time,
          ad.max_response_time,
          ad.p90_response_time,
          ad.p95_response_time,
          ad.p99_response_time,
          COALESCE(ad.total_count, 0) as total_count,
          COALESCE(ad.passed_count, 0) as passed_count,
          COALESCE(ad.failed_count, 0) as failed_count
        FROM time_series ts
        LEFT JOIN aggregated_data ad ON ts.time_bucket = ad.time_bucket
        ORDER BY ts.time_bucket ASC
      `;

      const queryParams = cutoffTime
        ? [testRunId, transactionName, samplerName, excludeRampUp, cutoffTime]
        : [testRunId, transactionName, samplerName, excludeRampUp, null];
      const samplerResult = await this.testRunRepo.query(samplerQuery, queryParams);

      this.logger.log(`Retrieved ${samplerResult.length} data points for sampler ${samplerName}`);

      return samplerResult.map((row: Record<string, unknown>) => this.parseTimeSeriesRow(row));
    } catch (error) {
      this.logger.error(`Failed to get time-series data for sampler ${samplerName}:`, error);
      throw new DatabaseException('Failed to retrieve sampler time-series data', error);
    }
  }
}
