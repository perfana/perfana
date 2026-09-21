import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trend SLO (`evaluate_type = 'trend'`): a run whose response times climb within the
 * steady state passes every scalar SLO and, when every baseline run drifts the same
 * way, ADAPT too. `StatisticsPipeline` now writes the OLS slope of each series as % of
 * its mean per hour, plus the correlation that says whether the slope is a trend or noise.
 * NULL on rows written before this version until the run is re-evaluated.
 */
export class AddDsMetricStatisticsTrend1809000000000 implements MigrationInterface {
  name = 'AddDsMetricStatisticsTrend1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE public.ds_metric_statistics ADD COLUMN IF NOT EXISTS trend_pct_per_hour double precision, ADD COLUMN IF NOT EXISTS trend_corr double precision'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE public.ds_metric_statistics DROP COLUMN IF EXISTS trend_pct_per_hour, DROP COLUMN IF EXISTS trend_corr'
    );
  }
}
