import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const NO_SCENARIO_SENTINEL = '__NO_SCENARIO__';

/**
 * Builds a SQL fragment + params for filtering by scenario_name.
 * Returns { clause: '', params: [] } when no scenarios are selected (no filter).
 *
 * The frontend can pass NO_SCENARIO_SENTINEL to include rows with NULL scenario_name.
 * startIndex is the $N position to use for the first new param (1-based).
 */
function buildScenarioFilter(
  scenarios: string[] | undefined,
  startIndex: number,
): { clause: string; params: unknown[] } {
  if (!scenarios || scenarios.length === 0) {
    return { clause: '', params: [] };
  }

  const includeNull = scenarios.includes(NO_SCENARIO_SENTINEL);
  const namedScenarios = scenarios.filter((s) => s !== NO_SCENARIO_SENTINEL);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (namedScenarios.length > 0) {
    conditions.push(`scenario_name = ANY($${startIndex})`);
    params.push(namedScenarios);
  }
  if (includeNull) {
    conditions.push(`scenario_name IS NULL`);
  }

  if (conditions.length === 0) return { clause: '', params: [] };

  return { clause: ` AND (${conditions.join(' OR ')})`, params };
}

/**
 * Variant of buildScenarioFilter for the test_run_transaction_stats rollup,
 * where scenario_name is `text NOT NULL DEFAULT ''` (the empty string represents
 * "no scenario", not NULL).
 */
function buildScenarioFilterForRollup(
  scenarios: string[] | undefined,
  startIndex: number,
): { clause: string; params: unknown[] } {
  if (!scenarios || scenarios.length === 0) {
    return { clause: '', params: [] };
  }

  const includeNull = scenarios.includes(NO_SCENARIO_SENTINEL);
  const namedScenarios = scenarios.filter((s) => s !== NO_SCENARIO_SENTINEL);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (namedScenarios.length > 0) {
    conditions.push(`scenario_name = ANY($${startIndex})`);
    params.push(namedScenarios);
  }
  if (includeNull) {
    conditions.push(`scenario_name = ''`);
  }

  if (conditions.length === 0) return { clause: '', params: [] };

  return { clause: ` AND (${conditions.join(' OR ')})`, params };
}

export interface ErrorSummary {
  totalErrors: number;
  uniqueResponseCodes: number;
  transactionsWithErrors: number;
  uniqueErrorUrls: number;
  totalRequests?: number;
  errorRate?: number;
}

export interface ErrorByCode {
  responseCode: string;
  errorCount: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
}

export interface ErrorByTransaction {
  transactionName: string;
  samplerName: string;
  url: string;
  errorCount: number;
  avgResponseTime: number;
  responseCode?: string;
}

export interface ErrorOverTime {
  timeBucket: string;
  errorsPerMinute: number;
}

export interface ErrorOverTimeByCode {
  timeBucket: string;
  [responseCode: string]: number | string; // Dynamic keys for each response code
}

export interface ErrorDetail {
  time: string;
  transactionName: string;
  samplerName: string;
  responseCode: string;
  responseTime: number;
  url: string;
  responseMessage: string;
  responseData: string;
  requestHeaders: string;
  responseHeaders: string;
}

@Injectable()
export class TestRunsErrorAnalysisService {
  private readonly logger = new Logger(TestRunsErrorAnalysisService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get error summary statistics for a test run
   */
  async getErrorSummary(testRunId: string, scenarios?: string[]): Promise<ErrorSummary> {
    this.logger.log(`Getting error summary for test run: ${testRunId}`);

    const { clause, params } = buildScenarioFilter(scenarios, 2);
    const query = `
      SELECT
        COUNT(*) as "totalErrors",
        COUNT(DISTINCT response_code) as "uniqueResponseCodes",
        COUNT(DISTINCT transaction_name) as "transactionsWithErrors",
        COUNT(DISTINCT url) as "uniqueErrorUrls"
      FROM requests_error
      WHERE test_run_id = $1${clause}
    `;

    const result = await this.dataSource.query(query, [testRunId, ...params]);

    if (!result || result.length === 0) {
      return {
        totalErrors: 0,
        uniqueResponseCodes: 0,
        transactionsWithErrors: 0,
        uniqueErrorUrls: 0,
      };
    }

    const summary: ErrorSummary = {
      totalErrors: parseInt(result[0].totalErrors, 10),
      uniqueResponseCodes: parseInt(result[0].uniqueResponseCodes, 10),
      transactionsWithErrors: parseInt(result[0].transactionsWithErrors, 10),
      uniqueErrorUrls: parseInt(result[0].uniqueErrorUrls, 10),
    };

    // Calculate total request count for error rate. Prefer the per-test-run
    // rollup table (test_run_transaction_stats) — a tens-of-rows scan — over
    // COUNT(*) FROM requests_raw, which scans the active hypertable chunk and
    // can take seconds on populated TimescaleDB. #287
    try {
      const totalRequests = await this.getTotalRequestCount(testRunId, scenarios);
      if (totalRequests !== null) {
        summary.totalRequests = totalRequests;
        summary.errorRate = totalRequests > 0 ? (summary.totalErrors / totalRequests) * 100 : 0;
      }
    } catch (error) {
      this.logger.warn(`Could not calculate error rate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return summary;
  }

  /**
   * Read total request count for a test run. Reads from
   * test_run_transaction_stats (rollup) when populated; falls back to
   * COUNT(*) FROM requests_raw when the rollup hasn't been computed yet.
   *
   * Returns null when neither path produces a value (e.g., test run still
   * ingesting and rollup not yet built — caller skips the errorRate field).
   */
  private async getTotalRequestCount(
    testRunId: string,
    scenarios?: string[],
  ): Promise<number | null> {
    // Rollup path: SUM(total_count) WHERE ramp_up_excluded = false matches the
    // pre-rollup behavior of COUNT(*) FROM requests_raw (no ramp-up filter).
    const rollupExists = await this.dataSource.query(
      `SELECT 1 FROM test_run_transaction_stats WHERE test_run_id = $1 LIMIT 1`,
      [testRunId],
    );

    if (rollupExists.length > 0) {
      const rollupFilter = buildScenarioFilterForRollup(scenarios, 2);
      const rollupQuery = `
        SELECT COALESCE(SUM(total_count), 0)::bigint AS total
        FROM test_run_transaction_stats
        WHERE test_run_id = $1
          AND ramp_up_excluded = false
          ${rollupFilter.clause}
      `;
      const result = await this.dataSource.query(rollupQuery, [testRunId, ...rollupFilter.params]);
      if (result && result.length > 0) {
        return parseInt(String(result[0].total), 10);
      }
      return null;
    }

    // Fallback: rollup not yet computed (ingestion in progress, or finalization
    // failed). Scan requests_raw directly — slow on big runs, but keeps the
    // error-rate readout populated for in-progress runs.
    const rawFilter = buildScenarioFilter(scenarios, 2);
    const totalRequestsQuery = `
      SELECT COUNT(*) as total
      FROM requests_raw
      WHERE test_run_id = $1${rawFilter.clause}
    `;
    const totalRequestsResult = await this.dataSource.query(
      totalRequestsQuery,
      [testRunId, ...rawFilter.params],
    );

    if (totalRequestsResult && totalRequestsResult.length > 0) {
      return parseInt(String(totalRequestsResult[0].total), 10);
    }
    return null;
  }

  /**
   * Get errors grouped by response code
   */
  async getErrorsByCode(testRunId: string, scenarios?: string[]): Promise<ErrorByCode[]> {
    this.logger.log(`Getting errors by code for test run: ${testRunId}`);

    const { clause, params } = buildScenarioFilter(scenarios, 2);
    const query = `
      SELECT
        response_code as "responseCode",
        COUNT(*) as "errorCount",
        ROUND(AVG(response_time)) as "avgResponseTime",
        MIN(response_time) as "minResponseTime",
        MAX(response_time) as "maxResponseTime"
      FROM requests_error
      WHERE test_run_id = $1${clause}
      GROUP BY response_code
      ORDER BY "errorCount" DESC
    `;

    const results = await this.dataSource.query(query, [testRunId, ...params]);

    return results.map((row: Record<string, unknown>) => ({
      responseCode: row.responseCode as string,
      errorCount: parseInt(String(row.errorCount), 10),
      avgResponseTime: parseFloat(String(row.avgResponseTime)),
      minResponseTime: row.minResponseTime as number,
      maxResponseTime: row.maxResponseTime as number,
    }));
  }

  /**
   * Get errors grouped by transaction/sampler/url
   */
  async getErrorsByTransaction(testRunId: string, scenarios?: string[]): Promise<ErrorByTransaction[]> {
    this.logger.log(`Getting errors by transaction for test run: ${testRunId}`);

    const { clause, params } = buildScenarioFilter(scenarios, 2);
    const query = `
      SELECT
        transaction_name as "transactionName",
        sampler_name as "samplerName",
        url,
        response_code as "responseCode",
        COUNT(*) as "errorCount",
        ROUND(AVG(response_time)) as "avgResponseTime"
      FROM requests_error
      WHERE test_run_id = $1${clause}
      GROUP BY transaction_name, sampler_name, url, response_code
      ORDER BY "errorCount" DESC
      LIMIT 100
    `;

    const results = await this.dataSource.query(query, [testRunId, ...params]);

    return results.map((row: Record<string, unknown>) => ({
      transactionName: row.transactionName as string,
      samplerName: row.samplerName as string,
      url: row.url as string,
      responseCode: row.responseCode as string,
      errorCount: parseInt(String(row.errorCount), 10),
      avgResponseTime: parseFloat(String(row.avgResponseTime)),
    }));
  }

  /**
   * Get errors over time (grouped by minute)
   */
  async getErrorsOverTime(testRunId: string, scenarios?: string[]): Promise<ErrorOverTime[]> {
    this.logger.log(`Getting errors over time for test run: ${testRunId}`);

    const { clause, params } = buildScenarioFilter(scenarios, 2);
    const query = `
      SELECT
        DATE_TRUNC('minute', time) as "timeBucket",
        COUNT(*) as "errorsPerMinute"
      FROM requests_error
      WHERE test_run_id = $1${clause}
      GROUP BY "timeBucket"
      ORDER BY "timeBucket"
    `;

    const results = await this.dataSource.query(query, [testRunId, ...params]);

    return results.map((row: Record<string, unknown>) => ({
      timeBucket: row.timeBucket as string,
      errorsPerMinute: parseInt(String(row.errorsPerMinute), 10),
    }));
  }

  /**
   * Get errors over time grouped by response code (for multi-line chart)
   */
  async getErrorsOverTimeByCode(testRunId: string, scenarios?: string[]): Promise<ErrorOverTimeByCode[]> {
    this.logger.log(`Getting errors over time by code for test run: ${testRunId}`);

    const { clause, params } = buildScenarioFilter(scenarios, 2);
    const query = `
      SELECT
        DATE_TRUNC('minute', time) as "timeBucket",
        response_code as "responseCode",
        COUNT(*) as "errorCount"
      FROM requests_error
      WHERE test_run_id = $1${clause}
      GROUP BY "timeBucket", response_code
      ORDER BY "timeBucket", response_code
    `;

    const results = await this.dataSource.query(query, [testRunId, ...params]);

    // Transform results into the format needed for the chart
    // Group by timeBucket and create dynamic properties for each response code
    const groupedByTime = new Map<string, ErrorOverTimeByCode>();

    results.forEach((row: Record<string, unknown>) => {
      const timeBucket = row.timeBucket as string;
      const responseCode = row.responseCode as string;
      const errorCount = parseInt(String(row.errorCount), 10);

      if (!groupedByTime.has(timeBucket)) {
        groupedByTime.set(timeBucket, { timeBucket });
      }

      const timeData = groupedByTime.get(timeBucket)!;
      timeData[responseCode] = errorCount;
    });

    return Array.from(groupedByTime.values()).sort((a, b) =>
      new Date(a.timeBucket).getTime() - new Date(b.timeBucket).getTime()
    );
  }

  /**
   * Get detailed error information for specific transaction/sampler/url
   */
  async getErrorDetails(
    testRunId: string,
    transactionName: string,
    samplerName: string,
    url: string,
  ): Promise<ErrorDetail[]> {
    this.logger.log(
      `Getting error details for test run: ${testRunId}, transaction: ${transactionName}, sampler: ${samplerName}`
    );

    const query = `
      SELECT
        time,
        transaction_name as "transactionName",
        sampler_name as "samplerName",
        response_code as "responseCode",
        response_time as "responseTime",
        url,
        response_message as "responseMessage",
        response_data as "responseData",
        request_headers as "requestHeaders",
        response_headers as "responseHeaders"
      FROM requests_error
      WHERE test_run_id = $1
        AND transaction_name = $2
        AND sampler_name = $3
        AND url = $4
      ORDER BY time DESC
      LIMIT 10
    `;

    const results = await this.dataSource.query(query, [
      testRunId,
      transactionName,
      samplerName,
      url,
    ]);

    return results.map((row: Record<string, unknown>) => ({
      time: row.time as string,
      transactionName: row.transactionName as string,
      samplerName: row.samplerName as string,
      responseCode: row.responseCode as string,
      responseTime: row.responseTime as number,
      url: row.url as string,
      responseMessage: (row.responseMessage as string) || '',
      responseData: (row.responseData as string) || '',
      requestHeaders: (row.requestHeaders as string) || '',
      responseHeaders: (row.responseHeaders as string) || '',
    }));
  }
}
