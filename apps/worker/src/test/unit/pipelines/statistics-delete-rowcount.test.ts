/**
 * Regression tests for the delete-count log line (#552).
 *
 * The old code read `deleteResult.rowCount` off what TypeORM actually returns for a
 * DELETE — `[rows, rowCount]` — where `.rowCount` is always `undefined`, so the log
 * claimed "Deleted 0 existing statistic records" no matter how many rows went. That
 * matters here: this pipeline is the #552 escape hatch, and the operator running it
 * on a stale baseline reads exactly this line to confirm the old rows were replaced.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatisticsPipeline } from '../../../pipelines/StatisticsPipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as databaseAccessor from '../../../common/database-accessor.js';

vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js');

describe('StatisticsPipeline delete-count logging (#552)', () => {
  let pipeline: StatisticsPipeline;
  let mockLogger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  let mockEntityManager: { query: ReturnType<typeof vi.fn> };

  /** All the info lines the pipeline emitted, joined for substring matching. */
  const infoLines = (): string => mockLogger.info.mock.calls.map((c) => String(c[0])).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.mocked(getLogger).mockReturnValue(mockLogger as never);

    mockEntityManager = { query: vi.fn().mockResolvedValue([]) };

    const mockDb = {
      transaction: vi.fn((fn: (m: unknown) => unknown) => {
        const proxy = new Proxy(mockEntityManager as Record<string, unknown>, {
          get(target: Record<string, unknown>, prop: string) {
            if (prop === 'query') {
              return (...args: unknown[]) => {
                if (
                  typeof args[0] === 'string' &&
                  (args[0].includes('SET LOCAL') || args[0].includes('UPDATE ds_metrics'))
                ) {
                  return Promise.resolve(undefined);
                }
                return (target.query as (...a: unknown[]) => unknown)(...args);
              };
            }
            return target[prop];
          },
        });
        return fn(proxy);
      }),
      query: vi.fn().mockResolvedValue([undefined, 0]),
    };

    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue(mockDb as never);
    pipeline = new StatisticsPipeline(mockLogger as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Queue the aggregation call sequence, with `deleteResult` for the DELETE. */
  const runWithDeleteResult = async (deleteResult: unknown) => {
    mockEntityManager.query
      .mockResolvedValueOnce([{ count: '100' }]) // metrics count
      .mockResolvedValueOnce(deleteResult) // DELETE existing
      .mockResolvedValueOnce([{ expected_rows: 10 }]) // expected rows
      .mockResolvedValueOnce(undefined) // INSERT
      .mockResolvedValueOnce([{ count: 10 }]); // actual count

    return pipeline.execute({ testRunIds: ['test-run-001'] });
  };

  test('reports the real row count from the [rows, rowCount] tuple TypeORM returns', async () => {
    const result = await runWithDeleteResult([[], 677]);

    expect(result.success).toBe(true);
    expect(infoLines()).toContain('Deleted 677 existing statistic records');
    // The old bug: a non-zero delete logged as zero.
    expect(infoLines()).not.toContain('Deleted 0 existing statistic records');
  });

  test('reports 0 when the DELETE genuinely removed nothing', async () => {
    await runWithDeleteResult([[], 0]);

    expect(infoLines()).toContain('Deleted 0 existing statistic records');
  });

  test('says so rather than claiming 0 when the driver returns an unexpected shape', async () => {
    await runWithDeleteResult({ rowCount: 42 });

    expect(infoLines()).toContain('Deleted an unknown number of existing statistic records');
    expect(infoLines()).not.toContain('Deleted 0 existing statistic records');
  });

  test('names the affected test runs alongside the count', async () => {
    mockEntityManager.query
      .mockResolvedValueOnce([{ count: '100' }])
      .mockResolvedValueOnce([[], 12])
      .mockResolvedValueOnce([{ expected_rows: 10 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 10 }]);

    await pipeline.execute({ testRunIds: ['baseline-1', 'baseline-2'] });

    expect(infoLines()).toContain('Deleted 12 existing statistic records for test runs: baseline-1, baseline-2');
  });
});
