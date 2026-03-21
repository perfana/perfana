import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
  async getErrorSummary(testRunId: string): Promise<ErrorSummary> {
    this.logger.log(`Getting error summary for test run: ${testRunId}`);

    const query = `
      SELECT
        COUNT(*) as "totalErrors",
        COUNT(DISTINCT response_code) as "uniqueResponseCodes",
        COUNT(DISTINCT transaction_name) as "transactionsWithErrors",
        COUNT(DISTINCT url) as "uniqueErrorUrls"
      FROM requests_error
      WHERE test_run_id = $1
    `;

    const result = await this.dataSource.query(query, [testRunId]);

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

    // Optionally calculate error rate if we have requests_raw data
    try {
      const totalRequestsQuery = `
        SELECT COUNT(*) as total
        FROM requests_raw
        WHERE test_run_id = $1
      `;
      const totalRequestsResult = await this.dataSource.query(totalRequestsQuery, [testRunId]);

      if (totalRequestsResult && totalRequestsResult.length > 0) {
        const totalRequests = parseInt(totalRequestsResult[0].total, 10);
        summary.totalRequests = totalRequests;
        summary.errorRate = totalRequests > 0 ? (summary.totalErrors / totalRequests) * 100 : 0;
      }
    } catch (error) {
      this.logger.warn(`Could not calculate error rate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return summary;
  }

  /**
   * Get errors grouped by response code
   */
  async getErrorsByCode(testRunId: string): Promise<ErrorByCode[]> {
    this.logger.log(`Getting errors by code for test run: ${testRunId}`);

    const query = `
      SELECT
        response_code as "responseCode",
        COUNT(*) as "errorCount",
        ROUND(AVG(response_time)) as "avgResponseTime",
        MIN(response_time) as "minResponseTime",
        MAX(response_time) as "maxResponseTime"
      FROM requests_error
      WHERE test_run_id = $1
      GROUP BY response_code
      ORDER BY "errorCount" DESC
    `;

    const results = await this.dataSource.query(query, [testRunId]);

    return results.map((row: any) => ({
      responseCode: row.responseCode,
      errorCount: parseInt(row.errorCount, 10),
      avgResponseTime: parseFloat(row.avgResponseTime),
      minResponseTime: row.minResponseTime,
      maxResponseTime: row.maxResponseTime,
    }));
  }

  /**
   * Get errors grouped by transaction/sampler/url
   */
  async getErrorsByTransaction(testRunId: string): Promise<ErrorByTransaction[]> {
    this.logger.log(`Getting errors by transaction for test run: ${testRunId}`);

    const query = `
      SELECT
        transaction_name as "transactionName",
        sampler_name as "samplerName",
        url,
        response_code as "responseCode",
        COUNT(*) as "errorCount",
        ROUND(AVG(response_time)) as "avgResponseTime"
      FROM requests_error
      WHERE test_run_id = $1
      GROUP BY transaction_name, sampler_name, url, response_code
      ORDER BY "errorCount" DESC
      LIMIT 100
    `;

    const results = await this.dataSource.query(query, [testRunId]);

    return results.map((row: any) => ({
      transactionName: row.transactionName,
      samplerName: row.samplerName,
      url: row.url,
      responseCode: row.responseCode,
      errorCount: parseInt(row.errorCount, 10),
      avgResponseTime: parseFloat(row.avgResponseTime),
    }));
  }

  /**
   * Get errors over time (grouped by minute)
   */
  async getErrorsOverTime(testRunId: string): Promise<ErrorOverTime[]> {
    this.logger.log(`Getting errors over time for test run: ${testRunId}`);

    const query = `
      SELECT
        DATE_TRUNC('minute', time) as "timeBucket",
        COUNT(*) as "errorsPerMinute"
      FROM requests_error
      WHERE test_run_id = $1
      GROUP BY "timeBucket"
      ORDER BY "timeBucket"
    `;

    const results = await this.dataSource.query(query, [testRunId]);

    return results.map((row: any) => ({
      timeBucket: row.timeBucket,
      errorsPerMinute: parseInt(row.errorsPerMinute, 10),
    }));
  }

  /**
   * Get errors over time grouped by response code (for multi-line chart)
   */
  async getErrorsOverTimeByCode(testRunId: string): Promise<ErrorOverTimeByCode[]> {
    this.logger.log(`Getting errors over time by code for test run: ${testRunId}`);

    const query = `
      SELECT
        DATE_TRUNC('minute', time) as "timeBucket",
        response_code as "responseCode",
        COUNT(*) as "errorCount"
      FROM requests_error
      WHERE test_run_id = $1
      GROUP BY "timeBucket", response_code
      ORDER BY "timeBucket", response_code
    `;

    const results = await this.dataSource.query(query, [testRunId]);

    // Transform results into the format needed for the chart
    // Group by timeBucket and create dynamic properties for each response code
    const groupedByTime = new Map<string, ErrorOverTimeByCode>();

    results.forEach((row: any) => {
      const timeBucket = row.timeBucket;
      const responseCode = row.responseCode;
      const errorCount = parseInt(row.errorCount, 10);

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

    return results.map((row: any) => ({
      time: row.time,
      transactionName: row.transactionName,
      samplerName: row.samplerName,
      responseCode: row.responseCode,
      responseTime: row.responseTime,
      url: row.url,
      responseMessage: row.responseMessage || '',
      responseData: row.responseData || '',
      requestHeaders: row.requestHeaders || '',
      responseHeaders: row.responseHeaders || '',
    }));
  }
}
