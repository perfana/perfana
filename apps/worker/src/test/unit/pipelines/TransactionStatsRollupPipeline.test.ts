import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionStatsRollupPipeline } from '../../../pipelines/TransactionStatsRollupPipeline.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};

// Single shared query spy — the pipeline issues two INSERT SELECTs then two
// COUNT(*) queries inside one transaction. We capture them all.
const mockManagerQuery = vi.fn();

const mockDb = {
  ensureConnection: vi.fn().mockResolvedValue(undefined),
  getTestRunByTestRunId: vi.fn(),
  transaction: vi.fn(),
};

vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDb),
}));

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
  logPerformance: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../lib/utils/timing.js', () => ({
  createPerformanceTimer: vi.fn(() => ({ logSummary: vi.fn() })),
}));

function makeTestRun(overrides: Record<string, unknown> = {}) {
  return {
    testRunId: 'run-001',
    systemUnderTestId: 'sut-uuid-1',
    testEnvironment: 'production',
    workload: 'default',
    startTime: new Date('2026-04-10T10:00:00Z'),
    analysisStartOffset: 60,
    completed: true,
    ...overrides,
  };
}

function wireTransaction(counts: { tx: number; sampler: number }) {
  // Simulate withAnalyticsTransaction → db.transaction → callback(manager)
  mockDb.transaction.mockImplementation(async (cb: any) => {
    mockManagerQuery.mockImplementation(async (sql: string) => {
      if (/SET LOCAL/i.test(sql)) return [];
      if (/FROM test_run_transaction_stats/i.test(sql)) {
        return [{ count: String(counts.tx) }];
      }
      if (/FROM test_run_sampler_stats/i.test(sql)) {
        return [{ count: String(counts.sampler) }];
      }
      // INSERT ... SELECT ... ON CONFLICT
      return [];
    });
    return await cb({ query: mockManagerQuery });
  });
}

describe('TransactionStatsRollupPipeline', () => {
  let pipeline: TransactionStatsRollupPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new TransactionStatsRollupPipeline(mockLogger as any);
  });

  describe('validateInput', () => {
    it('accepts { testRunId: string }', () => {
      expect(pipeline.validateInput({ testRunId: 'abc' })).toBe(true);
    });

    it('rejects empty or missing testRunId', () => {
      expect(pipeline.validateInput({})).toBe(false);
      expect(pipeline.validateInput({ testRunId: '' })).toBe(false);
      expect(pipeline.validateInput(null)).toBe(false);
      expect(pipeline.validateInput(undefined)).toBe(false);
    });
  });

  describe('execute', () => {
    it('returns error when test run does not exist', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(null);

      const result = await pipeline.execute({ testRunId: 'missing' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TEST_RUN_NOT_FOUND');
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('skips (success, no-op) when test run is not completed', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun({ completed: false }));

      const result = await pipeline.execute({ testRunId: 'run-001' });

      expect(result.success).toBe(true);
      expect((result.data as any).skipped).toBe('not-completed');
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('skips when start_time is missing', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun({ startTime: null }));

      const result = await pipeline.execute({ testRunId: 'run-001' });

      expect(result.success).toBe(true);
      expect((result.data as any).skipped).toBe('no-start-time');
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('runs both rollup inserts inside a single transaction', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 8, sampler: 42 });

      const result = await pipeline.execute({ testRunId: 'run-001' });

      expect(result.success).toBe(true);
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);

      const sqlCalls = mockManagerQuery.mock.calls.map(([sql]) => sql as string);
      expect(sqlCalls.some(s => /SET LOCAL work_mem/i.test(s))).toBe(true);
      expect(sqlCalls.some(s => /INSERT INTO test_run_transaction_stats/i.test(s))).toBe(true);
      expect(sqlCalls.some(s => /INSERT INTO test_run_sampler_stats/i.test(s))).toBe(true);
    });

    it('sets a 10-minute statement_timeout (longer than the live query it replaces)', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const sqlCalls = mockManagerQuery.mock.calls.map(([sql]) => sql as string);
      expect(sqlCalls.some(s => /SET LOCAL statement_timeout\s*=\s*'600000'/i.test(s))).toBe(true);
    });

    it('DELETEs stale rows before INSERTing so ramp-up edits cannot leave stale data', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const sqlCalls = mockManagerQuery.mock.calls.map(([sql]) => sql as string);
      const deleteTxIdx = sqlCalls.findIndex(s => /DELETE FROM test_run_transaction_stats/i.test(s));
      const insertTxIdx = sqlCalls.findIndex(s => /INSERT INTO test_run_transaction_stats/i.test(s));
      const deleteSamplerIdx = sqlCalls.findIndex(s => /DELETE FROM test_run_sampler_stats/i.test(s));
      const insertSamplerIdx = sqlCalls.findIndex(s => /INSERT INTO test_run_sampler_stats/i.test(s));

      expect(deleteTxIdx).toBeGreaterThanOrEqual(0);
      expect(insertTxIdx).toBeGreaterThan(deleteTxIdx);
      expect(deleteSamplerIdx).toBeGreaterThanOrEqual(0);
      expect(insertSamplerIdx).toBeGreaterThan(deleteSamplerIdx);
    });

    it('computes cutoff = start_time + analysisStartOffset seconds and passes it as $2', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(
        makeTestRun({
          startTime: new Date('2026-04-10T10:00:00Z'),
          analysisStartOffset: 120,
        }),
      );
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const insertCall = mockManagerQuery.mock.calls.find(([sql]) =>
        /INSERT INTO test_run_transaction_stats/i.test(sql as string),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      expect(params[0]).toBe('run-001');
      // 10:00:00Z + 120s = 10:02:00Z
      expect((params[1] as Date).toISOString()).toBe('2026-04-10T10:02:00.000Z');
    });

    it('treats analysisStartOffset = 0 as cutoff = start_time (identical variants)', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(
        makeTestRun({
          startTime: new Date('2026-04-10T10:00:00Z'),
          analysisStartOffset: 0,
        }),
      );
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const insertCall = mockManagerQuery.mock.calls.find(([sql]) =>
        /INSERT INTO test_run_transaction_stats/i.test(sql as string),
      );
      const params = insertCall![1] as unknown[];
      expect((params[1] as Date).toISOString()).toBe('2026-04-10T10:00:00.000Z');
    });

    it('treats null analysisStartOffset the same as 0', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(
        makeTestRun({
          startTime: new Date('2026-04-10T10:00:00Z'),
          analysisStartOffset: null,
        }),
      );
      wireTransaction({ tx: 1, sampler: 1 });

      const result = await pipeline.execute({ testRunId: 'run-001' });

      expect(result.success).toBe(true);
      expect((result.data as any).rampUpSeconds).toBe(0);
    });

    it('reports row counts in the success payload', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 14, sampler: 73 });

      const result = await pipeline.execute({ testRunId: 'run-001' });

      expect(result.success).toBe(true);
      expect((result.data as any).transactionRows).toBe(14);
      expect((result.data as any).samplerRows).toBe(73);
    });

    it('uses tdigest(size, value) for the pct_agg sketch in both rollup INSERTs (issue #278)', async () => {
      // Regression test for #278 + follow-up: the schema columns
      // `test_run_transaction_stats.pct_agg` and `test_run_sampler_stats.pct_agg`
      // are declared `tdigest`. Two ways this has gone wrong before:
      //   1. `percentile_agg(...)` returns `uddsketch` on the toolkit version
      //      we ship, so the INSERT aborts with a type mismatch.
      //   2. Single-arg `tdigest(value)` doesn't exist in toolkit ≥1.22 — the
      //      planner errors with `function tdigest(double precision) does not
      //      exist`. The aggregate signature is `tdigest(size integer, value
      //      double precision)`, so the bucket count is required.
      // Both forms abort the transaction silently → rollup tables stay empty.
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const inserts = mockManagerQuery.mock.calls
        .map(([sql]) => sql as string)
        .filter(s => /INSERT INTO test_run_(transaction|sampler)_stats/i.test(s));
      expect(inserts.length).toBe(2);
      for (const sql of inserts) {
        // Must be tdigest(size, value) — bucket count then column.
        expect(sql).toMatch(/tdigest\s*\(\s*\d+\s*,\s*[^)]*response_time/i);
        expect(sql).not.toMatch(/percentile_agg\s*\(\s*[^)]*response_time/i);
      }
    });

    it('writes a success-filtered pct_agg_passed sketch alongside pct_agg (issue #298)', async () => {
      // Regression test for #298: each rollup INSERT must populate the
      // pct_agg_passed column with a tdigest built only over `success = true`
      // rows, so the Apdex fast path can serve includeFailedRequests=false
      // benchmarks without bailing back to the legacy scan when the rollup
      // row carries failures.
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const inserts = mockManagerQuery.mock.calls
        .map(([sql]) => sql as string)
        .filter(s => /INSERT INTO test_run_(transaction|sampler)_stats/i.test(s));
      expect(inserts.length).toBe(2);
      for (const sql of inserts) {
        // The pct_agg_passed column must appear in the INSERT column list and
        // in the ON CONFLICT DO UPDATE branch.
        expect(sql).toMatch(/pct_agg_passed/);
        expect(sql).toMatch(/pct_agg_passed\s*=\s*EXCLUDED\.pct_agg_passed/);
        // And there must be at least one tdigest(...) FILTER (WHERE ... success)
        // in the CTE feeding the INSERT.
        expect(sql).toMatch(/tdigest\s*\([^)]*response_time[^)]*\)\s*FILTER\s*\(\s*WHERE[^)]*success/i);
      }
    });

    it('writes a ramp-up-excluded passed sketch in the second UNION row (issue #298)', async () => {
      // The full-window and ramp-up-excluded variants are emitted in the same
      // UNION ALL — both must carry their own pct_agg_passed. Otherwise the
      // Overview-tab fast path (excludeRampUp=true) would always miss when
      // include_failed_requests=false on a workload with failures.
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      wireTransaction({ tx: 1, sampler: 1 });

      await pipeline.execute({ testRunId: 'run-001' });

      const txInsert = mockManagerQuery.mock.calls
        .map(([sql]) => sql as string)
        .find(s => /INSERT INTO test_run_transaction_stats/i.test(s))!;
      // Two distinct success-filtered tdigest expressions — one bare, one
      // also gated on `time >= $2` for the ramp-up-excluded variant.
      const passedFullPattern = /tdigest\s*\([^)]*response_time[^)]*\)\s*FILTER\s*\(\s*WHERE\s+t\.success\s*\)/i;
      const passedExclPattern = /tdigest\s*\([^)]*response_time[^)]*\)\s*FILTER\s*\(\s*WHERE\s+t\.success\s+AND\s+t\.time\s*>=\s*\$2/i;
      expect(txInsert).toMatch(passedFullPattern);
      expect(txInsert).toMatch(passedExclPattern);

      const samplerInsert = mockManagerQuery.mock.calls
        .map(([sql]) => sql as string)
        .find(s => /INSERT INTO test_run_sampler_stats/i.test(s))!;
      expect(samplerInsert).toMatch(/FILTER\s*\(\s*WHERE\s+r\.success\s*\)/i);
      expect(samplerInsert).toMatch(/FILTER\s*\(\s*WHERE\s+r\.success\s+AND\s+r\.time\s*>=\s*\$2/i);
    });

    it('returns an error result when the database transaction throws', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(makeTestRun());
      mockDb.transaction.mockRejectedValue(new Error('db unavailable'));

      const result = await pipeline.execute({ testRunId: 'run-001' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TRANSACTION_STATS_ROLLUP_FAILED');
      expect(result.error?.message).toContain('db unavailable');
    });
  });
});
