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

    // dataSource.transaction(isolationLevel, cb) — the isolation level is load-bearing here
    // (see the REPEATABLE READ comment in deletePerfTestMetricsForRun), so the fake accepts
    // the two-arg form and the tests assert on it.
    const dataSource = {
      query,
      transaction: vi.fn(
        async (
          levelOrCb: string | ((m: { query: typeof txQuery }) => unknown),
          maybeCb?: (m: { query: typeof txQuery }) => unknown
        ) => {
          const cb = typeof levelOrCb === 'function' ? levelOrCb : maybeCb!;
          return cb({ query: txQuery });
        }
      ),
    };

    service = Object.create(WorkerDatabaseService.prototype) as WorkerDatabaseService;
    Object.defineProperty(service, 'dataSource', { value: dataSource, writable: true });
    Object.defineProperty(service, 'logger', {
      value: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      writable: true,
    });
  });

  /** The SQL of every statement in the transaction except the `lock_timeout` preamble. */
  const workSqls = (): string[] =>
    txQuery.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((sql: string) => !sql.includes('set_config'));

  /** The one `set_config` call, or undefined if the preamble is missing. */
  const lockTimeoutCall = (): unknown[] | undefined =>
    txQuery.mock.calls.find((c: unknown[]) => String(c[0]).includes('set_config'));

  describe('nothing to preserve', () => {
    it('issues the bare segment-targeted delete', async () => {
      txQuery.mockResolvedValue([[], 2620348]);

      const result = await service.deletePerfTestMetricsForRun('tr-1', ['performance_test']);

      expect(result).toEqual({ deleted: 2620348, restored: 0 });
      const sqls = workSqls();
      expect(sqls).toHaveLength(1);
      expect(sqls[0]).toContain('DELETE FROM ds_metrics WHERE test_run_id = $1');
      expect(txQuery.mock.calls.at(-1)?.[1]).toEqual(['tr-1']);
      // The predicate that made this expensive must not come back.
      expect(sqls[0]).not.toContain('metrics_source_id');
    });

    it('treats a run with no rows at all as nothing to preserve', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', []);
      expect(workSqls()).toEqual([expect.stringContaining('DELETE FROM ds_metrics')]);
    });

    it('wraps the single statement in a transaction, only to scope the lock timeout', async () => {
      // A transaction for one DELETE looks gratuitous and is not: `SET LOCAL` needs a scope to
      // be local to, and a session-level `SET` would leak the budget onto a pooled connection.
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test']);

      const ds = (service as unknown as { dataSource: { transaction: ReturnType<typeof vi.fn> } }).dataSource;
      expect(ds.transaction).toHaveBeenCalledTimes(1);
      // Default isolation — only the preserve path needs one snapshot across two statements.
      expect(typeof ds.transaction.mock.calls[0][0]).toBe('function');
      expect(query).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // lock_timeout — the delete takes RowExclusive on EVERY chunk (no time
  // predicate), so a compress/drop/DDL on any unrelated chunk blocks it.
  // Observed 2026-09-28: 238,643 ms on 32,698 rows, against 3,255 ms for
  // 228,557 rows an hour earlier, with worker and API both idle.
  // -------------------------------------------------------------------------

  describe('lock timeout', () => {
    it.each([
      ['nothing to preserve', ['performance_test']],
      ['other sources present', ['performance_test', 'grafana']],
    ])('bounds the lock wait on the %s path', async (_label, sourceTypes) => {
      await service.deletePerfTestMetricsForRun('tr-1', sourceTypes as string[]);

      const call = lockTimeoutCall();
      expect(call).toBeDefined();
      expect(call![1]).toEqual(['lock_timeout', '30000']);
    });

    it('sets the timeout BEFORE any statement that can block', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'grafana']);

      // Ordering is the whole point: a budget applied after the DELETE has begun bounds nothing.
      expect(String(txQuery.mock.calls[0][0])).toContain('set_config');
    });

    it('is transaction-local, so it cannot follow the connection back into the pool', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test']);

      // `set_config(name, value, is_local)` — the third argument is what makes it revert on
      // commit. Passed false, every later query on this pooled connection inherits the budget.
      expect(lockTimeoutCall()![0]).toContain('set_config($1, $2, true)');
    });

    it('lets a lock timeout propagate rather than retrying it here', async () => {
      // Only 40001 is retried. A holder that outlasts 30 s outlasts a 1 s backoff too, so the
      // stage must fail visibly and let the job's own retry policy wait for the holder to go.
      const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), {
        code: '55P03',
      });
      // The preamble succeeds; the DELETE is what blocks and then aborts.
      txQuery.mockResolvedValueOnce([]).mockRejectedValueOnce(lockTimeout);

      await expect(service.deletePerfTestMetricsForRun('tr-1', ['performance_test'])).rejects.toThrow(
        /lock timeout/
      );
      // One attempt, not two: 40001 is retried here, 55P03 is not.
      const ds = (service as unknown as { dataSource: { transaction: ReturnType<typeof vi.fn> } }).dataSource;
      expect(ds.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('other sources present', () => {
    it('copies the survivors aside, deletes wholesale, then restores them — in one transaction', async () => {
      txQuery
        .mockResolvedValueOnce([]) // set_config lock_timeout
        .mockResolvedValueOnce([[], 0]) // CREATE TEMP TABLE ... AS SELECT
        .mockResolvedValueOnce([{ n: 3120 }]) // SELECT count(*) FROM ds_metrics_keep
        .mockResolvedValueOnce([[], 2620348]) // DELETE
        .mockResolvedValueOnce([[], 0]); // INSERT back — no RETURNING, so no usable count

      const result = await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'grafana']);

      // deleted excludes what was put straight back
      expect(result).toEqual({ deleted: 2620348 - 3120, restored: 3120 });

      // One snapshot for the copy and the delete. At READ COMMITTED a row committed between
      // them would be deleted without ever being copied, and narrowing the DELETE to spare it
      // would reintroduce the non-segmentby predicate this method exists to avoid.
      const ds = (service as unknown as { dataSource: { transaction: ReturnType<typeof vi.fn> } }).dataSource;
      expect(ds.transaction.mock.calls[0][0]).toBe('REPEATABLE READ');

      const sqls = workSqls();
      expect(sqls[0]).toContain('CREATE TEMP TABLE ds_metrics_keep');
      expect(sqls[0]).toContain('ON COMMIT DROP');
      // The survivor count comes from the temp table, never from the INSERT result:
      // an INSERT without RETURNING has no rowCount in TypeORM's [rows, rowCount] shape.
      expect(sqls[1]).toContain('count(*)::int AS n FROM ds_metrics_keep');
      expect(sqls[2]).toContain('DELETE FROM ds_metrics WHERE test_run_id = $1');
      expect(sqls[3]).toContain('INSERT INTO ds_metrics SELECT * FROM ds_metrics_keep');

      // The delete itself stays segment-targeted even here.
      expect(sqls[2]).not.toContain('metrics_source_id');
      // Nothing ran outside the transaction.
      expect(query).not.toHaveBeenCalled();
    });

    it('keeps rows with a NULL metrics_source_id, which no source re-collects', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'unknown']);

      const keepSql = workSqls()[0]!;
      expect(keepSql).toContain('metrics_source_id IS NULL');
      expect(keepSql).toContain("source_type = 'performance_test'");
      expect(keepSql).toContain('NOT IN');
    });

    it('preserves other sources even when they are ALSO being re-collected', async () => {
      // An external source may return nothing on the refetch, and its stored rows are then
      // the only copy. So presence alone decides — a caller passing the SELECTED source types
      // instead would take the no-preserve branch here and delete them.
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'grafana', 'dynatrace']);

      expect(workSqls()).toHaveLength(4);
      expect(workSqls()[0]).toContain('CREATE TEMP TABLE ds_metrics_keep');
      // The bare delete is the branch that would have destroyed them.
      expect(query).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Per-statement timing. The caller logs one aggregate for all three, so when
  // this method took 238,882 ms it was SLOW_QUERY_MS catching the DELETE by
  // coincidence that identified which one had stalled.
  // -------------------------------------------------------------------------

  describe('timing breakdown', () => {
    const logged = (): string =>
      ((service as unknown as { logger: { log: ReturnType<typeof vi.fn> } }).logger.log.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((m: string) => m.includes('timing')) ?? '');

    it('names each of the three statements on the preserve path', async () => {
      txQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[], 0])
        .mockResolvedValueOnce([{ n: 12 }])
        .mockResolvedValueOnce([[], 400])
        .mockResolvedValueOnce([[], 0]);

      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test', 'dynatrace']);

      // The point is attribution, not the numbers: all three have to be separable.
      expect(logged()).toMatch(/copy \d+ms, delete \d+ms, restore \d+ms/);
      expect(logged()).toContain('tr-1');
    });

    it('reports the delete on the bare path too', async () => {
      await service.deletePerfTestMetricsForRun('tr-1', ['performance_test']);
      expect(logged()).toMatch(/delete \d+ms/);
    });
  });

  // -------------------------------------------------------------------------
  // getRunMetricsSourceTypes — the input the preserve decision is made from
  // -------------------------------------------------------------------------

  describe('getRunMetricsSourceTypes', () => {
    it('LEFT JOINs and reports a NULL metrics_source_id as unknown', async () => {
      // Both halves are load-bearing. An INNER JOIN would drop the orphan rows from the
      // result, `hasRowsToPreserve` would then read false, and the wholesale delete would
      // remove rows nothing re-collects — with every other test in this file still green.
      query.mockResolvedValue([{ source_type: 'grafana' }, { source_type: 'unknown' }]);

      await expect(service.getRunMetricsSourceTypes('tr-1')).resolves.toEqual([
        'grafana',
        'unknown',
      ]);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('LEFT JOIN metrics_sources');
      expect(sql).toContain("COALESCE(ms.source_type, 'unknown')");
      expect(params).toEqual(['tr-1']);
    });

    it('returns [] for a run with no ds_metrics rows', async () => {
      query.mockResolvedValue([]);
      await expect(service.getRunMetricsSourceTypes('tr-1')).resolves.toEqual([]);
    });

    it('returns [] rather than throwing when the driver hands back a non-array', async () => {
      query.mockResolvedValue(undefined as never);
      await expect(service.getRunMetricsSourceTypes('tr-1')).resolves.toEqual([]);
    });
  });
});
