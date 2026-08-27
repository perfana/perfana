import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen the continuous-aggregate refresh windows from 1-2 hours to 7 days.
 *
 * The 5 s CAGGs (`requests_raw_5s`, `transactions_5s`, ...) shipped with
 * `start_offset => 1 hour`, so a policy run only ever materialises
 * `[now - 1 hour, now - 1 minute]`. Two ordinary situations fall outside that
 * window and are therefore *never* materialised:
 *
 *   - a test run longer than an hour (a 1 h 53 m run leaves its first ~53 min
 *     permanently unmaterialised), and
 *   - results ingested after the fact, which is the normal case — the JTL is
 *     uploaded when the run finishes, by which time its early buckets have
 *     already aged out of the window.
 *
 * The CAGGs are real-time aggregates, so nothing looks broken: the query
 * silently unions the materialised part with a live aggregation over the raw
 * hypertable. `GET /test-runs/:id/throughput` for such a run seq-scans
 * ~1.4 M raw rows with a 43 MB external sort on every page load (measured
 * 2766 ms; 577 ms once the window is materialised). Short runs from a system
 * that tests continuously always land inside the 1-hour window, which is why
 * only some systems' detail pages feel slow.
 *
 * 7 days matches `compress_after` on the raw hypertables, so refreshes stay in
 * the uncompressed region. Re-refreshing an already-materialised window is a
 * no-op (~7 ms, "already up-to-date"), so the wider window costs nothing at
 * steady state — the policies consult the invalidation log, they do not
 * recompute the range.
 *
 * The first policy run after this migration works through the invalidation log
 * for the whole widened window (observed: ~5000 batches per view), so anything
 * ingested in the last 7 days catches up on its own. Expect one busy pass.
 * Runs older than 7 days stay unmaterialised — to backfill history once, per
 * view:
 *   CALL refresh_continuous_aggregate('requests_raw_5s', NULL, now() - interval '1 minute');
 * That one is expensive (minutes to hours) and deliberately not done here — a
 * migration runs at API startup.
 *
 * This is necessary but not sufficient: a refresh policy also has to be able to
 * get a background worker. See the max_worker_processes comment on the postgres
 * service in docker-compose.infra.yml — with the image default the scheduler
 * cannot launch the jobs at all and no start_offset saves you.
 */
export class WidenCaggRefreshWindows1799000000000 implements MigrationInterface {
  name = 'WidenCaggRefreshWindows1799000000000';

  /** end_offset / schedule_interval are unchanged; only start_offset moves. `was` is the shipped value, restored by down(). */
  private static readonly POLICIES = [
    { view: 'requests_raw_5s', end: '1 minute', schedule: '30 seconds', was: '1 hour' },
    { view: 'requests_raw_1m', end: '2 minutes', schedule: '1 minute', was: '2 hours' },
    { view: 'requests_raw_5m', end: '5 minutes', schedule: '5 minutes', was: '1 day' },
    { view: 'transactions_5s', end: '1 minute', schedule: '30 seconds', was: '1 hour' },
    { view: 'transactions_1m', end: '2 minutes', schedule: '1 minute', was: '2 hours' },
    { view: 'transactions_5m', end: '5 minutes', schedule: '5 minutes', was: '1 day' },
    { view: 'requests_error_5s', end: '1 minute', schedule: '30 seconds', was: '1 hour' },
    { view: 'requests_error_1m', end: '2 minutes', schedule: '1 minute', was: '2 hours' },
    { view: 'requests_error_5m', end: '5 minutes', schedule: '5 minutes', was: '1 day' },
    { view: 'requests_raw_passed_5s', end: '1 minute', schedule: '30 seconds', was: '1 hour' },
    { view: 'requests_raw_passed_1m', end: '2 minutes', schedule: '1 minute', was: '2 hours' },
    { view: 'requests_raw_passed_5m', end: '5 minutes', schedule: '5 minutes', was: '1 day' },
    { view: 'transactions_passed_5s', end: '1 minute', schedule: '30 seconds', was: '1 hour' },
    { view: 'transactions_passed_1m', end: '2 minutes', schedule: '1 minute', was: '2 hours' },
    { view: 'transactions_passed_5m', end: '5 minutes', schedule: '5 minutes', was: '1 day' },
  ];

  /** `start` of null restores each policy's shipped offset. */
  private async setStartOffset(queryRunner: QueryRunner, start: string | null): Promise<void> {
    for (const p of WidenCaggRefreshWindows1799000000000.POLICIES) {
      const startOffset = start ?? p.was;
      // SAVEPOINT, not a bare try/catch. Migrations run under
      // runMigrations({ transaction: 'each' }), so a failing statement aborts the
      // whole transaction (25P02) and every later statement — including TypeORM's
      // own INSERT into the migrations table — dies with "current transaction is
      // aborted". Catching the error is not enough to keep going; the savepoint is
      // what actually makes the next policy runnable.
      await queryRunner.query('SAVEPOINT cagg_refresh_policy');
      try {
        // No ALTER for a refresh policy — drop and re-add is the documented way.
        await queryRunner.query(
          `SELECT remove_continuous_aggregate_policy('${p.view}', if_not_exists => TRUE)`,
        );
        await queryRunner.query(`
          SELECT add_continuous_aggregate_policy('${p.view}',
            start_offset      => INTERVAL '${startOffset}',
            end_offset        => INTERVAL '${p.end}',
            schedule_interval => INTERVAL '${p.schedule}',
            if_not_exists     => TRUE
          )
        `);
        await queryRunner.query('RELEASE SAVEPOINT cagg_refresh_policy');
      } catch (error: unknown) {
        // A deploy without TimescaleDB, or without these CAGGs, keeps booting.
        await queryRunner.query('ROLLBACK TO SAVEPOINT cagg_refresh_policy');
        console.warn(
          `  Warning: could not set refresh window for ${p.view}:`,
          (error as Error).message,
        );
      }
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.setStartOffset(queryRunner, '7 days');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setStartOffset(queryRunner, null);
  }
}
