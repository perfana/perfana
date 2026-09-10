import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerDatabaseService } from '../../../common/database.service.js';

/**
 * #563. `test_run_id` is ds_metrics' `compress_segmentby`, so `DELETE ... WHERE test_run_id = $1`
 * is segment-targeted and needs no decompression — 181 ms / 41 MB WAL on a 2.45M-row run,
 * against 162 s / 11 GB for the decompress-then-filtered-delete it replaces.
 *
 * The filtered form it replaces only removed `performance_test` rows. Grafana and Dynatrace rows
 * were left alone and upserted over, so a re-collection that returned nothing — expired retention,
 * a lapsed token — left the old rows intact. Perfana exists to keep those metrics after the source
 * has dropped them, so the wholesale delete must not take them on the promise of a refetch.
 * These tests pin that: the survivors are every non-perf-test row, and it is not a coverage
 * question about what happens to be selected.
 */
describe('WorkerDatabaseService.deletePerfTestMetricsForRun', () => {
  let query: ReturnType<typeof vi.fn>;
  let txQuery: ReturnType<typeof vi.fn>;
  let service: WorkerDatabaseService;

  beforeEach(() => {
    query = vi.fn().mockResolvedValue([[], 0]);
    txQuery = vi.fn().mockResolvedValue([[], 0]);

    const dataSource = {
      query,
      transaction: vi.fn(async (cb: (m: { query: typeof txQuery }) => unknown) => cb({ query: txQuery })),
    };

    service = Object.create(WorkerDatabaseService.prototype) as WorkerDatabaseService;
    Object.defineProperty(service, 'dataSource', { value: dataSource, writable: true });
    Object.defineProperty(service, 'logger', {
      value: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      writable: true,
    });
  });

  describe('nothing to preserve', () => {
    it('issues the bare segment-targeted delete, outside a transaction', async () => {
      query.mockResolvedValue([[], 2620348]);

      const result = await service.deletePerfTestMetricsForRun('tr-1', ['performance_test']);

      expect(result).toEqual({ deleted: 2620348, restored: 0 });
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('DELETE FROM ds_metrics WHERE test_run_id = $1');
      expect(params).toEqual(['tr-1']);
      // The predicate that made this expensive must not come back.
      expect(sql).not.toContain('metrics_source_id');
    });

    it('treats a run with no rows at all as nothing to preserve', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', []);
      expect(query).toHaveBeenCalledTimes(1);
      expect(String(query.mock.calls[0][0])).toContain('DELETE FROM ds_metrics');
    });
  });

  describe('other sources present', () => {
    it('copies the survivors aside, deletes wholesale, then restores them — in one transaction', async () => {
      txQuery
        .mockResolvedValueOnce([[], 0]) // CREATE TEMP TABLE ... AS SELECT
        .mockResolvedValueOnce([[], 2620348]) // DELETE
        .mockResolvedValueOnce([[], 3120]); // INSERT back

      const result = await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'grafana']);

      // deleted excludes what was put straight back
      expect(result).toEqual({ deleted: 2620348 - 3120, restored: 3120 });

      const sqls = txQuery.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(sqls[0]).toContain('CREATE TEMP TABLE ds_metrics_keep');
      expect(sqls[0]).toContain('ON COMMIT DROP');
      expect(sqls[1]).toContain('DELETE FROM ds_metrics WHERE test_run_id = $1');
      expect(sqls[2]).toContain('INSERT INTO ds_metrics SELECT * FROM ds_metrics_keep');

      // The delete itself stays segment-targeted even here.
      expect(sqls[1]).not.toContain('metrics_source_id');
      // Nothing ran outside the transaction.
      expect(query).not.toHaveBeenCalled();
    });

    it('keeps rows with a NULL metrics_source_id, which no source re-collects', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'unknown']);

      const keepSql = String(txQuery.mock.calls[0][0]);
      expect(keepSql).toContain('metrics_source_id IS NULL');
      expect(keepSql).toContain("source_type = 'performance_test'");
      expect(keepSql).toContain('NOT IN');
    });

    it('preserves other sources even when they are ALSO being re-collected', async () => {
      // The signature takes only what is PRESENT, never what is selected — an external source
      // may return nothing, and its stored rows are then the only copy. Making this depend on
      // the refetch selection is the regression these tests exist to prevent.
      expect(service.deletePerfTestMetricsForRun.length).toBe(2);

      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'grafana', 'dynatrace']);

      expect(txQuery).toHaveBeenCalledTimes(3);
      expect(String(txQuery.mock.calls[0][0])).toContain('CREATE TEMP TABLE ds_metrics_keep');
    });
  });
});
