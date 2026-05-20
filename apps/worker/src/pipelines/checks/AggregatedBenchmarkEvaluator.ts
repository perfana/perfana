import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService } from './BaseCheckService.js';
import type { TestRun } from './BenchmarkMatcher.js';

export interface AggregatedBenchmark {
  id: string;
  aggregate_metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage';
  aggregate_stat?: string;
  requirement_operator: string;
  requirement_value: number;
  exclude_ramp_up_time: boolean;
}

export interface AggregatedCheckResult {
  benchmark_id: string;
  test_run_id: string;
  actual_value: number | null;
  meets_requirement: boolean | null;
  status: 'COMPLETE' | 'NO_DATA' | 'ERROR';
  message: string;
}

const STAT_SQL: Record<string, string> = {
  avg: 'AVG(response_time)',
  p50: 'PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time)',
  p90: 'PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_time)',
  p95: 'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time)',
  p99: 'PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time)',
  max: 'MAX(response_time)',
};

/**
 * Service to evaluate aggregated SLO benchmarks.
 *
 * Aggregated benchmarks compute statistics across all requests in a test run
 * (e.g. p95 transaction response time, overall error percentage) and compare
 * against a requirement threshold using an operator (<=, <, >=, >).
 */
export class AggregatedBenchmarkEvaluator extends BaseCheckService {
  constructor(
    logger: Logger,
    private readonly manager: EntityManager,
  ) {
    super(logger);
  }

  async evaluate(testRun: TestRun, benchmark: AggregatedBenchmark): Promise<AggregatedCheckResult> {
    try {
      const actualValue = await this.computeMetric(testRun, benchmark);

      if (actualValue === null) {
        return {
          benchmark_id: benchmark.id,
          test_run_id: testRun.test_run_id,
          actual_value: null,
          meets_requirement: null,
          status: 'NO_DATA',
          message: 'No data found for aggregated metric',
        };
      }

      const meetsRequirement = this.applyOperator(actualValue, benchmark.requirement_operator, benchmark.requirement_value);
      const unit = benchmark.aggregate_metric === 'error_percentage' ? '%' : 'ms';
      const label = benchmark.aggregate_stat
        ? `${benchmark.aggregate_stat.toUpperCase()} ${actualValue.toFixed(2)}${unit}`
        : `${actualValue.toFixed(2)}${unit}`;

      return {
        benchmark_id: benchmark.id,
        test_run_id: testRun.test_run_id,
        actual_value: actualValue,
        meets_requirement: meetsRequirement,
        status: 'COMPLETE',
        message: `${label} ${benchmark.requirement_operator} ${benchmark.requirement_value}${unit}: ${meetsRequirement ? 'PASS' : 'FAIL'}`,
      };
    } catch (error) {
      this.logger.error(`AggregatedBenchmarkEvaluator failed for benchmark ${benchmark.id}: ${error}`);
      return {
        benchmark_id: benchmark.id,
        test_run_id: testRun.test_run_id,
        actual_value: null,
        meets_requirement: null,
        status: 'ERROR',
        message: `Evaluation failed: ${error}`,
      };
    }
  }

  private async computeMetric(testRun: TestRun, benchmark: AggregatedBenchmark): Promise<number | null> {
    const params: unknown[] = [testRun.test_run_id];
    let paramIndex = 2;

    const rampUpClause = (): string => {
      if (benchmark.exclude_ramp_up_time && testRun.ramp_up && testRun.start_time) {
        const rampUpEnd = new Date(testRun.start_time.getTime() + testRun.ramp_up * 1000);
        params.push(rampUpEnd);
        return ` AND time >= $${paramIndex++}`;
      }
      return '';
    };

    if (benchmark.aggregate_metric === 'error_percentage') {
      const sql = `
        SELECT (COUNT(*) FILTER (WHERE success = false))::float / NULLIF(COUNT(*), 0) * 100 AS result
        FROM requests_raw
        WHERE test_run_id = $1${rampUpClause()}
      `;
      const rows = await this.manager.query(sql, params) as { result: string | null }[];
      const val = rows[0]?.result;
      return val !== null && val !== undefined ? parseFloat(String(val)) : null;
    }

    const statSql = STAT_SQL[benchmark.aggregate_stat ?? 'avg'] ?? 'AVG(response_time)';
    const table = benchmark.aggregate_metric === 'transaction_response_time' ? 'transactions' : 'requests_raw';

    const sql = `
      SELECT ${statSql} AS result
      FROM ${table}
      WHERE test_run_id = $1${rampUpClause()}
    `;
    const rows = await this.manager.query(sql, params) as { result: string | null }[];
    const val = rows[0]?.result;
    return val !== null && val !== undefined ? parseFloat(String(val)) : null;
  }

  private applyOperator(actual: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '<=': return actual <= threshold;
      case '<':  return actual <  threshold;
      case '>=': return actual >= threshold;
      case '>':  return actual >  threshold;
      default:   return actual <= threshold;
    }
  }
}
