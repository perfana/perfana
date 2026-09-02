/**
 * Regression tests for #552.
 *
 * A baseline whose `ds_metric_statistics` rows predate the `pct_agg` sketch (#289)
 * used to push ControlGroupStatisticsPipeline onto the legacy raw-scan path, which
 * times out on a large baseline. `ds_control_group_statistics` stayed empty and ADAPT
 * dead-ended on INSUFFICIENT_DATA with no way out from the UI.
 *
 * The pipeline now recomputes the missing sketches first, so the fast path applies.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ControlGroupStatisticsPipeline } from '../../../pipelines/ControlGroupStatisticsPipeline.js';
import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';

const mockDatabaseService = {
  transaction: vi.fn(),
  query: vi.fn(),
};

vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDatabaseService),
}));

const statisticsExecute = vi.fn();
vi.mock('../../../pipelines/StatisticsPipeline.js', () => ({
  StatisticsPipeline: vi.fn().mockImplementation(() => ({ execute: statisticsExecute })),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  silent: vi.fn(),
  child: vi.fn(() => mockLogger),
  level: 'info',
} as unknown as Logger;

describe('ControlGroupStatisticsPipeline sketch backfill (#552)', () => {
  let pipeline: ControlGroupStatisticsPipeline;
  let mockEntityManager: Partial<EntityManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEntityManager = { query: vi.fn() };

    mockDatabaseService.transaction.mockImplementation(async (callback: (m: EntityManager) => Promise<unknown>) => {
      const proxy = new Proxy(mockEntityManager as Record<string, unknown>, {
        get(target: Record<string, unknown>, prop: string) {
          if (prop === 'query') {
            return (...args: unknown[]) => {
              if (
                typeof args[0] === 'string' &&
                (args[0].includes('SET LOCAL') || args[0].includes('set_config'))
              ) {
                return Promise.resolve(undefined);
              }
              return (target.query as (...a: unknown[]) => unknown)(...args);
            };
          }
          return target[prop];
        },
      });
      return await callback(proxy as unknown as EntityManager);
    });

    statisticsExecute.mockResolvedValue({ success: true });
    pipeline = new ControlGroupStatisticsPipeline(mockLogger);
  });

  /** Queue up the entity-manager responses for one control group. */
  const mockControlGroupQueries = (missingSketches: number) => {
    const q = mockEntityManager.query as ReturnType<typeof vi.fn>;
    q.mockResolvedValueOnce([
      {
        control_group_id: 'cg-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'acc',
        test_runs: ['baseline-1'],
        n_test_runs: 1,
      },
    ]);
    q.mockResolvedValueOnce([{ count: '12370' }]);
    q.mockResolvedValueOnce([{ missing_sketches: missingSketches }]);
    q.mockResolvedValueOnce([{ expected_rows: 677 }]);
    q.mockResolvedValueOnce({ rowCount: 677 });
  };

  test('recomputes statistics for control runs whose pct_agg is NULL, then takes the fast path', async () => {
    // Cleanup query, then the backfill lookup finds the stale baseline.
    mockDatabaseService.query.mockResolvedValueOnce([[], 0]);
    mockDatabaseService.query.mockResolvedValueOnce([{ test_run_id: 'baseline-1' }]);

    // After the backfill the sketches exist, so the availability check reports none missing.
    mockControlGroupQueries(0);

    const result = await pipeline.execute({ controlGroupIds: ['cg-1'] });

    expect(statisticsExecute).toHaveBeenCalledWith({ testRunIds: ['baseline-1'] });
    expect(result.success).toBe(true);

    // Fast path, not the raw scan over ds_metrics that used to time out.
    const aggregationSql = (mockEntityManager.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    expect(aggregationSql).toContain('rollup(ms.pct_agg)');
    expect(aggregationSql).not.toContain('percentile_agg(m.value)');
  });

  test('falls back to the legacy raw-scan path when the backfill itself fails', async () => {
    mockDatabaseService.query.mockResolvedValueOnce([[], 0]);
    mockDatabaseService.query.mockResolvedValueOnce([{ test_run_id: 'baseline-1' }]);

    statisticsExecute.mockResolvedValue({ success: false, errors: [{ message: 'statement timeout' }] });

    // The sketches are still missing afterwards, so the availability check reports them.
    mockControlGroupQueries(12370);

    const result = await pipeline.execute({ controlGroupIds: ['cg-1'] });

    // Best-effort: a failed backfill must not abort the aggregation.
    expect(result.success).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Sketch backfill failed'));

    const aggregationSql = (mockEntityManager.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
    expect(aggregationSql).toContain('percentile_agg(m.value)');
  });

  test('skips the backfill when the lookup returns no rows at all', async () => {
    mockDatabaseService.query.mockResolvedValueOnce([[], 0]);
    // Some drivers hand back undefined rather than an empty array.
    mockDatabaseService.query.mockResolvedValueOnce(undefined);

    mockControlGroupQueries(0);

    const result = await pipeline.execute({ controlGroupIds: ['cg-1'] });

    expect(statisticsExecute).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test('does not recompute statistics when every control run already has its sketch', async () => {
    mockDatabaseService.query.mockResolvedValueOnce([[], 0]);
    mockDatabaseService.query.mockResolvedValueOnce([]);

    mockControlGroupQueries(0);

    const result = await pipeline.execute({ controlGroupIds: ['cg-1'] });

    expect(statisticsExecute).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
