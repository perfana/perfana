import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trend SLO (`evaluate_type = 'trend'`): a run whose response times climb within the
 * steady state passes every scalar SLO and, when every baseline run drifts the same
 * way, ADAPT too. `StatisticsPipeline` now writes the OLS slope of each series as % of
 * its mean per hour, plus the correlation that says whether the slope is a trend or noise.
 * NULL on rows written before this version until the run is re-evaluated.
 *
 * Same lock discipline as 1795: ADD COLUMN needs ACCESS EXCLUSIVE for an instant, and
 * `ds_metric_statistics` is held for up to 540 s by a running aggregation. Without a
 * lock_timeout the ALTER would wait behind it and queue every later read on the table
 * behind the ALTER. The retry is plpgsql because TypeORM runs the migration in one
 * transaction and a lock_timeout error would poison it.
 */
export class AddDsMetricStatisticsTrend1809000000000 implements MigrationInterface {
  name = 'AddDsMetricStatisticsTrend1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $add_column$
      DECLARE
        attempt int := 0;
      BEGIN
        PERFORM set_config('lock_timeout', '3s', true);
        LOOP
          attempt := attempt + 1;
          BEGIN
            EXECUTE 'ALTER TABLE public.ds_metric_statistics ADD COLUMN IF NOT EXISTS trend_pct_per_hour double precision, ADD COLUMN IF NOT EXISTS trend_corr double precision';
            RETURN;
          EXCEPTION WHEN lock_not_available THEN
            IF attempt >= 10 THEN
              RAISE EXCEPTION
                'could not add ds_metric_statistics trend columns: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
            END IF;
            PERFORM pg_sleep(3);
          END;
        END LOOP;
      END
      $add_column$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE public.ds_metric_statistics DROP COLUMN IF EXISTS trend_pct_per_hour, DROP COLUMN IF EXISTS trend_corr'
    );
  }
}
