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
});
