import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EntityManager } from 'typeorm';
import { ResultsProcessor } from '../../../pipelines/helpers/adapt/results-processor.js';
import { ControlGroupsPipeline } from '../../../pipelines/ControlGroupsPipeline.js';

/**
 * Two halves of issue #616 items 2 and 3, both of which were silent: a log line that read
 * `(0 rows)` on a successful upsert, and one that named the test run `undefined` on the one
 * statement that can mark a run FAILED.
 */

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

vi.mock('../../../common/database-accessor.js', () => ({ getDatabaseService: vi.fn(() => ({})) }));
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => logger),
  logPerformance: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('../../../lib/utils/timing.js', () => ({
  createPerformanceTimer: vi.fn(() => ({ logSummary: vi.fn() })),
}));

describe('row counts come from RETURNING, not from an INSERT with no rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generateConclusions asks for RETURNING 1 and counts what comes back', async () => {
    const processor = new ResultsProcessor(logger as never);
    // TypeORM hands back the pg `rows` for an INSERT; without RETURNING that is always [].
    const manager = { query: vi.fn().mockResolvedValue([{ '?column?': 1 }, { '?column?': 1 }]) };

    const count = await processor.generateConclusions(manager as unknown as EntityManager, ['run-1']);

    expect(count).toBe(2);
    expect(manager.query.mock.calls[0]![0] as string).toMatch(/RETURNING 1\s*$/);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('affected 2 rows'));
  });
});

describe('the stuck-status reset names the run it failed, and compares in UTC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the rows out of [rows, rowCount] and casts lastUpdate as timestamptz', async () => {
    const pipeline = new ControlGroupsPipeline(logger as never);
    // An UPDATE ... RETURNING comes back as [rows, affected] — iterating the result itself
    // yields the rows array and the number, so `row.test_run_id` was undefined.
    const manager = {
      query: vi.fn().mockResolvedValue([
        [{ test_run_id: 'run-1', adapt_status: 'FAILED', comparisons_status: 'COMPLETED' }],
        1,
      ]),
    };

    await (pipeline as unknown as {
      resetStuckInProgressStatuses(m: EntityManager, ids: string[]): Promise<void>;
    }).resetStuckInProgressStatuses(manager as unknown as EntityManager, ['run-1']);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('run-1'));
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('undefined'));

    const sql = manager.query.mock.calls[0]![0] as string;
    // A bare ::timestamp drops the Z and is read in the session timezone, so on a non-UTC
    // deployment every IN_PROGRESS run looks hours stale and is set to FAILED.
    expect(sql).not.toMatch(/::timestamp[^t]/);
    expect(sql).toContain("(status->>'lastUpdate')::timestamptz");
  });
});
