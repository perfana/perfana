import { describe, it, expect, vi } from 'vitest';
import { EntityManager } from 'typeorm';
import pino from 'pino';
import { AggregatedBenchmarkEvaluator, AggregatedBenchmark } from '../../../pipelines/checks/AggregatedBenchmarkEvaluator.js';
import type { TestRun } from '../../../pipelines/checks/BenchmarkMatcher.js';

const logger = pino({ level: 'silent' });

const makeManager = (queryResult: unknown[]) =>
  ({ query: vi.fn().mockResolvedValue(queryResult) }) as unknown as EntityManager;

const testRun: TestRun = {
  test_run_id: 'tr-1',
  system_under_test_id: 'sut-1',
  test_environment: 'staging',
  workload: 'baseline',
  ramp_up: 60,
};

const baseBenchmark: AggregatedBenchmark = {
  id: 'b-1',
  aggregate_metric: 'transaction_response_time',
  aggregate_stat: 'p95',
  requirement_operator: '<=',
  requirement_value: 2000,
  exclude_ramp_up_time: true,
};

describe('AggregatedBenchmarkEvaluator', () => {
  it('returns PASS when p95 is under threshold', async () => {
    const manager = makeManager([{ result: '1500' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.meets_requirement).toBe(true);
    expect(result.actual_value).toBe(1500);
    expect(result.status).toBe('COMPLETE');
  });

  it('returns FAIL when p95 exceeds threshold', async () => {
    const manager = makeManager([{ result: '2500' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.meets_requirement).toBe(false);
    expect(result.actual_value).toBe(2500);
  });

  it('returns NO_DATA when query returns null result', async () => {
    const manager = makeManager([{ result: null }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.status).toBe('NO_DATA');
    expect(result.meets_requirement).toBeNull();
  });

  it('evaluates error_percentage without aggregate_stat', async () => {
    const manager = makeManager([{ result: '0.5' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const errBenchmark: AggregatedBenchmark = {
      ...baseBenchmark,
      aggregate_metric: 'error_percentage',
      aggregate_stat: undefined,
      requirement_value: 1,
    };
    const result = await evaluator.evaluate(testRun, errBenchmark);
    expect(result.meets_requirement).toBe(true);  // 0.5 <= 1
    expect(result.actual_value).toBe(0.5);
  });

  it('applies >= operator correctly', async () => {
    const manager = makeManager([{ result: '1800' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, {
      ...baseBenchmark,
      requirement_operator: '>=',
      requirement_value: 2000,
    });
    expect(result.meets_requirement).toBe(false);  // 1800 is not >= 2000
  });

  it('applies < operator correctly', async () => {
    const manager = makeManager([{ result: '1999' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, { ...baseBenchmark, requirement_operator: '<', requirement_value: 2000 });
    expect(result.meets_requirement).toBe(true);  // 1999 < 2000
  });

  it('applies > operator correctly', async () => {
    const manager = makeManager([{ result: '2001' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, { ...baseBenchmark, requirement_operator: '>', requirement_value: 2000 });
    expect(result.meets_requirement).toBe(true);  // 2001 > 2000
  });

  it('falls back to <= for unknown operator', async () => {
    const manager = makeManager([{ result: '1000' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, { ...baseBenchmark, requirement_operator: 'invalid', requirement_value: 2000 });
    expect(result.meets_requirement).toBe(true);  // 1000 <= 2000 via default
  });

  it('evaluates request_response_time metric from requests_raw table', async () => {
    const manager = makeManager([{ result: '300' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, {
      ...baseBenchmark,
      aggregate_metric: 'request_response_time',
      aggregate_stat: 'avg',
      requirement_value: 500,
    });
    expect(result.meets_requirement).toBe(true);
    expect(result.actual_value).toBe(300);
    const call = (manager.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('FROM requests_raw');
    expect(call[0]).not.toContain('is_transaction');
  });

  it('evaluates transaction_response_time metric from transactions table', async () => {
    const manager = makeManager([{ result: '800' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    await evaluator.evaluate(testRun, { ...baseBenchmark, aggregate_metric: 'transaction_response_time' });
    const sql: string = (manager.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain('FROM transactions');
    expect(sql).not.toContain('is_transaction');
  });

  it('returns ERROR status when query throws', async () => {
    const manager = { query: vi.fn().mockRejectedValue(new Error('DB down')) } as unknown as EntityManager;
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.status).toBe('ERROR');
    expect(result.meets_requirement).toBeNull();
    expect(result.message).toContain('Evaluation failed');
  });

  it('returns NO_DATA when query returns empty array', async () => {
    const manager = makeManager([]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.status).toBe('NO_DATA');
  });

  it('uses AVG fallback for unrecognised aggregate_stat', async () => {
    const manager = makeManager([{ result: '800' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    await evaluator.evaluate(testRun, { ...baseBenchmark, aggregate_stat: 'unknown_stat' });
    const sql: string = (manager.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain('AVG(response_time)');
  });

  it('uses response_time column not elapsed', async () => {
    const manager = makeManager([{ result: '1200' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    await evaluator.evaluate(testRun, baseBenchmark);
    const sql: string = (manager.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain('response_time');
    expect(sql).not.toContain('elapsed');
  });

  it('applies ramp-up exclusion when exclude_ramp_up_time is true and testRun has start_time', async () => {
    const manager = makeManager([{ result: '1000' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const testRunWithStartTime: TestRun = {
      ...testRun,
      start_time: new Date('2026-01-01T10:00:00Z'),
      ramp_up: 60,
    };
    await evaluator.evaluate(testRunWithStartTime, { ...baseBenchmark, exclude_ramp_up_time: true });
    const call = (manager.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('time >=');
    expect(call[1]).toHaveLength(2);
    expect(call[1][1]).toEqual(new Date('2026-01-01T10:01:00Z'));
  });

  it('skips ramp-up exclusion when exclude_ramp_up_time is false', async () => {
    const manager = makeManager([{ result: '1000' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    await evaluator.evaluate(testRun, { ...baseBenchmark, exclude_ramp_up_time: false });
    const call = (manager.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).not.toContain('time >=');
    expect(call[1]).toHaveLength(1);
  });
});
