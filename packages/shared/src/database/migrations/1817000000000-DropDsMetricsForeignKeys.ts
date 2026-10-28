import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the two foreign keys `ds_metrics` carries, to `application_dashboards` and to
 * `metrics_sources`. They are the half of the SUT-delete timeout (see
 * 1816000000000-IndexFkProbeColumns) that an index cannot fix.
 *
 * Why an index does not fix it. `ds_metrics` is a compressed hypertable with
 * `compress_segmentby = test_run_id`, so `application_dashboard_id` and `metrics_source_id`
 * live inside the compressed payload. Verified on the dev database with a throwaway
 * hypertable of the same shape: the index IS created on the compressed chunk and is never
 * used, because there is nothing for a btree to point at.
 *
 *   Custom Scan (ColumnarScan) on _hyper_21_26_chunk x
 *     Vectorized Filter: (pid = '0000…'::uuid)
 *     Rows Removed by Filter: 1000          <- every row, index ignored
 *     ->  Seq Scan on _hyper_21_26_chunk_compressed
 *   indexes on chunk: …_time_idx, …_pid_idx  <- present and unusable
 *
 * And the FK is genuinely enforced across that compressed data — the parent DELETE is
 * refused when the only referencing rows are compressed — so the probe really does read it.
 * On production everything older than two days is compressed (`DS_METRICS_COMPRESS_*`), which
 * is to say: almost the whole table, scanned once per deleted parent row, per FK.
 *
 * TimescaleDB also clones each FK onto every chunk, and each clone installs its own pair of
 * parent-side RI triggers on `application_dashboards` / `metrics_sources` — verified in
 * `pg_trigger`. So the probe count grows with the chunk count, forever.
 *
 * What the FKs were buying, and what is given up. Both are `NO ACTION` on delete and update,
 * so no cascade behaviour depends on them. Nothing in the codebase reads their 23503 as a
 * signal: the 409 handlers in `grafana-dashboards.service.ts` are for
 * `grafana_dashboards <- application_dashboards`, and
 * `ApplicationDashboardsService.remove` pre-deletes `ds_metrics` precisely to AVOID the
 * violation rather than to rely on it. What is given up is the guarantee that no `ds_metrics`
 * row points at a deleted dashboard or metrics source. Severity is low: every read of
 * `ds_metrics` filters by an `application_dashboard_id` that came from a live dashboard, so
 * an orphan is invisible rather than wrong, and uuids are not reused. It is dead weight that
 * nothing sweeps, and that is the trade.
 *
 * The other four raw hypertables — `requests_raw`, `transactions`, `virtual_users`,
 * `requests_error` — carry no foreign keys at all. `ds_metrics` was the only one, which is
 * the strongest argument that these two were an artefact of the TypeORM `@ManyToOne` on the
 * entity rather than a decision. Those two decorators are removed in the same change, with a
 * comment, so nobody puts the FKs back by writing a relation.
 *
 * One planner consequence worth knowing: Postgres uses foreign keys for join-selectivity
 * estimation, so estimates for `ds_metrics ⋈ application_dashboards` change. Nothing in the
 * repo joins them in a hot path, but a plan regression there would point here.
 *
 * Dropping the root constraint removes every chunk clone and every parent-side trigger with
 * it — verified on the dev database inside a rolled-back transaction, 0 clones and 0 chunk
 * triggers left. The whole thing is one catalog update, so the ACCESS EXCLUSIVE lock is held
 * for microseconds once granted; the wait for it is what needs a bound.
 *
 * `down()` recreates them with NOT VALID. A plain `ADD CONSTRAINT` would validate by reading
 * the entire hypertable under ACCESS EXCLUSIVE, which on production is an outage; NOT VALID
 * restores enforcement for new rows at once and leaves the backfill check to whoever wants
 * it (`VALIDATE CONSTRAINT`, which takes only SHARE UPDATE EXCLUSIVE).
 */

const CONSTRAINTS: ReadonlyArray<readonly [string, string, string]> = [
  ['FK_6b21df61b6b75801a94435590ab', 'application_dashboard_id', 'application_dashboards'],
  ['FK_64b571cec128bcfa57a7aafd9d0', 'metrics_source_id', 'metrics_sources'],
];

/** Same plpgsql lock-retry shape as 1814/1816; see 1816 for why it is not TypeScript. */
function lockSafe(tag: string, statements: readonly string[]): string {
  const array = statements.map((s) => `'${s.replace(/'/g, "''")}'`).join(',\n      ');
  return `
    DO $${tag}$
    DECLARE
      stmt text;
      attempt int;
      stmts text[] := ARRAY[
      ${array}
      ];
    BEGIN
      PERFORM set_config('lock_timeout', '3s', true);
      FOREACH stmt IN ARRAY stmts LOOP
        attempt := 0;
        LOOP
          attempt := attempt + 1;
          BEGIN
            EXECUTE stmt;
            EXIT;
          EXCEPTION WHEN lock_not_available THEN
            IF attempt >= 10 THEN
              RAISE EXCEPTION
                'could not apply "%": ds_metrics stayed locked across % attempts. Find the holder (pg_stat_activity) and retry the deploy.', stmt, attempt;
            END IF;
            PERFORM pg_sleep(3);
          END;
        END LOOP;
      END LOOP;
    END
    $${tag}$;
  `;
}

export class DropDsMetricsForeignKeys1817000000000 implements MigrationInterface {
  name = 'DropDsMetricsForeignKeys1817000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      lockSafe(
        'drop_ds_metrics_fks',
        CONSTRAINTS.map(
          ([name]) => `ALTER TABLE public.ds_metrics DROP CONSTRAINT IF EXISTS "${name}"`,
        ),
      ),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      lockSafe(
        'add_ds_metrics_fks',
        CONSTRAINTS.map(
          ([name, column, parent]) =>
            `ALTER TABLE public.ds_metrics ADD CONSTRAINT "${name}" ` +
            `FOREIGN KEY (${column}) REFERENCES public.${parent}(id) NOT VALID`,
        ),
      ),
    );
  }
}
