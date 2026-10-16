import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { ApdexCalculator } from '../../../pipelines/checks/ApdexCalculator.js';
import { AggregatedBenchmarkEvaluator } from '../../../pipelines/checks/AggregatedBenchmarkEvaluator.js';
import type { TestRun } from '../../../pipelines/checks/BenchmarkMatcher.js';
import type { EntityManager } from 'typeorm';

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../../lib/utils/logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));

/**
 * Issue #674: a read on `requests_raw`, `transactions`, `requests_error` or
 * `virtual_users` filtered on `test_run_id` alone locks EVERY chunk of the table plus
 * every compressed twin plus the indexes on both — 136 relation locks where 21 cover
 * the same rows, growing ~365 per table per year at daily chunks. The worker shares a
 * pool of 2-4 connections, so it will not exhaust the lock table on its own; it is
 * sharing that table with the API, which will.
 *
 * Nothing behavioural can see this — the result sets are identical — so the guard is
 * on the emitted SQL, the same shape as the two in `apps/api`.
 *
 * The second half guards the trap: reading `start_time` / `end_time` off a joined
 * `test_runs` in the same statement looks like the fix and is worse, because chunk
 * exclusion for locking happens at plan time and a correlated subquery is not
 * available then (150 locks against 136 for no predicate at all).
 */

const HYPERTABLE = /(?:FROM|JOIN)\s+(?:requests_raw|transactions|requests_error|virtual_users)\b(?!_5s|_passed)/;
/** The trap: a `time` comparison against a column of the joined `test_runs`. */
const READS_RUN_TIMES = /time\s*(?:>=|<=|>|<|BETWEEN)\s*tr\./i;

const RUN_WINDOW_ROW = [{
  start_time: '2026-01-01T10:00:00.000Z',
  ramp_up: '120',
  end_time: '2026-01-01T11:00:00.000Z',
  ramp_down: '60',
}];
const WINDOW_START = new Date('2026-01-01T09:00:00.000Z');
const WINDOW_END = new Date('2026-01-01T12:00:00.000Z');

const testRun = {
  test_run_id: 'run-001',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  start_time: new Date('2026-01-01T10:00:00Z'),
  end_time: new Date('2026-01-01T11:00:00Z'),
  ramp_up: 120,
} as TestRun;

describe('worker raw-hypertable time bounds (#674)', () => {
  let query: ReturnType<typeof vi.fn>;
  let manager: EntityManager;

  beforeEach(() => {
    query = vi.fn(async (sql: string) =>
      /start_time, ramp_up, end_time, ramp_down/.test(sql) ? RUN_WINDOW_ROW : [],
    );
    manager = { query } as unknown as EntityManager;
  });

  const hypertableReads = () =>
    (query.mock.calls as [string, unknown[]][]).filter(([sql]) => HYPERTABLE.test(sql));

  const assertBounded = (expected?: [Date, Date]) => {
    const reads = hypertableReads();
    expect(reads.length).toBeGreaterThan(0);
    for (const [sql, params] of reads) {
      expect(sql).toMatch(/time >= \$\d+/);
      expect(sql).not.toMatch(READS_RUN_TIMES);
      const dates = (params ?? []).filter((p): p is Date => p instanceof Date);
      expect(dates.length).toBeGreaterThan(0);
      if (expected) {
        expect(dates.map((d) => d.toISOString())).toContain(expected[0].toISOString());
        expect(dates.map((d) => d.toISOString())).toContain(expected[1].toISOString());
      }
    }
  };

  describe('ApdexCalculator', () => {
    it.each([false, true])('bounds the raw transactions scan (excludeRampUp=%s)', async (excludeRampUp) => {
      query.mockImplementation(async (sql: string) => {
        if (/start_time, ramp_up, end_time, ramp_down/.test(sql)) return RUN_WINDOW_ROW;
        // No rollup → the raw scan, which is the arm that reads the hypertable.
        if (/test_run_transaction_stats|test_run_sampler_stats/.test(sql)) return [];
        return [{ satisfied_count: '1', tolerating_count: '0', frustrated_count: '0', total_count: '1', observed_count: '1', avg_response_time_ms: '10' }];
      });

      await new ApdexCalculator(pino({ level: 'silent' }), manager).calculateApdex({
        testRun, transactionName: null, thresholdMs: 500,
        includeFailedRequests: false, excludeRampUp,
      });

      // With the toggle off the bound is the padded run window; with it on the head is
      // trimmed to the ramp cutoff, and the tail stays the padded end (this TestRun
      // shape carries no ramp_down).
      assertBounded(excludeRampUp ? undefined : [WINDOW_START, WINDOW_END]);
    });

    it('bounds the raw fallbacks behind an empty rollup', async () => {
      await new ApdexCalculator(pino({ level: 'silent' }), manager).getAvailableTransactions('run-001');
      await new ApdexCalculator(pino({ level: 'silent' }), manager).getTransactionsWithScenarios('run-001');
      assertBounded([WINDOW_START, WINDOW_END]);
    });
  });

  describe('AggregatedBenchmarkEvaluator', () => {
    it.each([false, true])('bounds the raw error-rate scan (excludeRampUp=%s)', async (excludeRampUp) => {
      const evaluator = new AggregatedBenchmarkEvaluator(pino({ level: 'silent' }), manager);
      await evaluator.evaluate(testRun, {
        id: 'b1',
        aggregate_metric: 'error_percentage',
        requirement_operator: 'lt',
        requirement_value: 5,
        exclude_ramp_up_time: excludeRampUp,
      } as never);

      assertBounded(excludeRampUp ? undefined : [WINDOW_START, WINDOW_END]);
    });
  });
});
