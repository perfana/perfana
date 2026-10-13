import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService } from './BaseCheckService.js';
import type { TestRun } from './BenchmarkMatcher.js';
import { evaluateRequirement } from './requirement-operator.js';

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

const ROLLUP_TABLE: Record<string, string> = {
  transaction_response_time: 'test_run_transaction_stats',
  request_response_time: 'test_run_sampler_stats',
};

/**
 * Rollup equivalents of STAT_SQL, for the two stats the rollup answers EXACTLY.
 *
 * `avg` is the count-weighted mean of the stored per-group averages; those are
 * ROUND(...,2) at write time, so the result differs in the 4th decimal at most
 * (292.9742 raw vs 292.9737 rollup on a 200k-row run).
 * `max` reads the tdigest's own min/max fields, which are stored verbatim and
 * survive `rollup()` — byte-identical to `MAX(max_response_time)` on all 12
 * sampler-rollup variants of the dev database, and to the raw `MAX` on both
 * transaction runs that still have their raw rows.
 *
 * PERCENTILES ARE DELIBERATELY ABSENT. `approx_percentile(q, rollup(pct_agg))`
 * bounds its RANK error, not its value, and an SLO is a pass/fail gate on the
 * value. Where the distribution has a cliff the two diverge wildly: on the three
 * Bravo runs of the dev database, raw p95 433/410/503 ms read 846/732/872 ms
 * through the rollup (+74..+95 %), because raw p95 = 410 ms and raw p96 = 2092 ms
 * -- 0.2 percentile-points of rank error is 300 ms of value error there. A
 * `p95 <= 500 ms` SLO would flip PASS -> FAIL. The other 33 runs agreed within
 * ~2 %, which is exactly what makes this unsafe: it looks fine until it isn't.
 * Percentiles keep the exact raw scan. If that scan ever has to go, the rollup
 * needs a relative-error sketch (uddsketch/`percentile_agg`, as
 * `ds_metric_statistics` carries), not this one.
 */
const ROLLUP_STAT_SQL: Record<string, string> = {
  avg: 'SUM(avg_response_time * total_count) / NULLIF(SUM(total_count), 0)',
  max: 'max_val(rollup(pct_agg))',
};

const toNumber = (val: string | null | undefined): number | null =>
  val !== null && val !== undefined ? parseFloat(String(val)) : null;

/**
 * Service to evaluate aggregated SLO benchmarks.
 *
 * Aggregated benchmarks compute statistics across all requests in a test run
 * (e.g. p95 transaction response time, overall error percentage) and compare
 * against a requirement threshold using any operator the SLO dialog offers
 * (`lt lte gt gte eq ne`, or their symbols) — see requirement-operator.ts.
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
      // Rollup first. The raw count below has no index it can use — `success` is not the
      // segmentby key and the run is ~10 % of a 7-day chunk — so it reads the run's whole
      // chunk (~10 GB, 3–136 s per run on WERKNL, 81 % of a batch re-evaluate). The sampler
      // rollup holds the same two counts per (sampler, ramp_up_excluded), and on six
      // production runs its ratio matched the stored raw value to 4 decimals. The rollup's
      // window also trims ramp-down where the raw clause trims ramp-up only; that never
      // moved a verdict and is the same residue ApdexCalculator carries.
      const rollup = await this.manager.query(
        `SELECT COUNT(*)::int AS rows,
                SUM(failed_count)::float / NULLIF(SUM(total_count), 0) * 100 AS result
           FROM test_run_sampler_stats
          WHERE test_run_id = $1 AND ramp_up_excluded = $2`,
        [testRun.test_run_id, benchmark.exclude_ramp_up_time === true],
      ) as { rows: number; result: string | null }[];
      if ((rollup[0]?.rows ?? 0) > 0) {
        return toNumber(rollup[0]?.result);
      }
      // Raw scan only when the run has no rollup at all (analyze died before
      // transaction-stats-rollup, or a re-evaluate that ChecksPipeline could not repair).
      const sql = `
        SELECT (COUNT(*) FILTER (WHERE success = false))::float / NULLIF(COUNT(*), 0) * 100 AS result
        FROM requests_raw
        WHERE test_run_id = $1${rampUpClause()}
      `;
      const rows = await this.manager.query(sql, params) as { result: string | null }[];
      return toNumber(rows[0]?.result);
    }

    const stat = benchmark.aggregate_stat && STAT_SQL[benchmark.aggregate_stat]
      ? benchmark.aggregate_stat
      : 'avg';

    // Rollup first, for the stats it answers exactly -- see ROLLUP_STAT_SQL. The raw
    // query below reads every response_time of the run and (for a percentile) sorts
    // them: the same ~10 GB chunk scan the error_percentage arm used to pay, and a
    // 100-run bulk re-evaluate on such an SLO would spend the whole checks stage there.
    // Same ramp-up residue as that arm: the rollup's excluded variant also trims
    // ramp-down, where the raw clause trims ramp-up only. One extra residue on the
    // sampler side -- the rollup skips rows with a NULL transaction_name (252 of 11,545
    // on a k6 run of the dev database), which the raw scan counts.
    const rollupTable = ROLLUP_TABLE[benchmark.aggregate_metric];
    const rollupStat = ROLLUP_STAT_SQL[stat];
    if (rollupTable && rollupStat) {
      const rollup = await this.manager.query(
        `SELECT COUNT(*)::int AS rows, ${rollupStat} AS result
           FROM ${rollupTable}
          WHERE test_run_id = $1 AND ramp_up_excluded = $2`,
        [testRun.test_run_id, benchmark.exclude_ramp_up_time === true],
      ) as { rows: number; result: string | null }[];
      if ((rollup[0]?.rows ?? 0) > 0) {
        return toNumber(rollup[0]?.result);
      }
    }

    const statSql = STAT_SQL[stat] ?? 'AVG(response_time)';
    const table = benchmark.aggregate_metric === 'transaction_response_time' ? 'transactions' : 'requests_raw';

    const sql = `
      SELECT ${statSql} AS result
      FROM ${table}
      WHERE test_run_id = $1${rampUpClause()}
    `;
    const rows = await this.manager.query(sql, params) as { result: string | null }[];
    return toNumber(rows[0]?.result);
  }

  private applyOperator(actual: number, operator: string, threshold: number): boolean {
    // The SLO dialog stores codes (`lt`, `gte`, …), not symbols; before v0.2.95.31 every
    // code fell through to `<=` here, so a "greater than" aggregate SLO passed on any value
    // at or below its threshold.
    const met = evaluateRequirement(actual, operator, threshold);
    if (met === null) {
      // Same policy as RequirementChecker: an operator nobody defined passes, with a warning.
      this.logger.warn(`Unknown requirement operator: ${operator}`);
      return true;
    }
    return met;
  }
}
