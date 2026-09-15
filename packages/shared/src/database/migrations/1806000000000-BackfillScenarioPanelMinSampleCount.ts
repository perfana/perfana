import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * v0.2.95.28 added an ADAPT sample floor (`ADAPT_MIN_SAMPLE_COUNT`, default 2): a metric
 * with fewer data points than that on the test run or in its control group is
 * `incomparable`. The perf-test scenario panels — Error Count (301), Avg Active Threads
 * (302), Max Active Threads (303) — hold ONE point per run by construction, so the
 * pipeline writes `thresholds.minSampleCount: 1` into their panel-level compare config to
 * opt out.
 *
 * That write is `INSERT … ON CONFLICT DO NOTHING` (PerformanceTestMetricsPipeline
 * `insertCompareConfigBatch`), so a config row that already existed before this version
 * never gains the key and falls back to the deployment default — every existing
 * workload's scenario panels would turn `incomparable` for good on upgrade. This
 * backfill adds the key to those rows exactly once; a row that already carries a
 * `minSampleCount` (a user override) is left alone.
 *
 * A perf-test dashboard is recognised through its metrics source, or by the
 * `performance-test-metrics-` uid prefix where the source is missing: application
 * dashboards restored from a SUT export arrive with `metrics_source_id` NULL (CLAUDE.md,
 * "`grafana_dashboards` is a mixed table", trap 2), and on the dev database that is all
 * 75 of them.
 */
export class BackfillScenarioPanelMinSampleCount1806000000000 implements MigrationInterface {
  name = 'BackfillScenarioPanelMinSampleCount1806000000000';

  static readonly SCENARIO_PANEL_IDS = [301, 302, 303];

  static readonly SQL = `
    UPDATE ds_compare_config c
    SET config_data = c.config_data || jsonb_build_object(
          'thresholds',
          COALESCE(c.config_data->'thresholds', '{}'::jsonb) || '{"minSampleCount": 1}'::jsonb
        )
    WHERE c.panel_id IN (${BackfillScenarioPanelMinSampleCount1806000000000.SCENARIO_PANEL_IDS.join(', ')})
      AND c.metric_name IS NULL
      AND c.config_data->'thresholds'->'minSampleCount' IS NULL
      AND EXISTS (
        SELECT 1
        FROM application_dashboards ad
        LEFT JOIN metrics_sources ms ON ms.id = ad.metrics_source_id
        WHERE ad.id = c.application_dashboard_id
          AND (ms.source_type = 'performance_test' OR ad.dashboard_uid LIKE 'performance-test-metrics-%')
      )
  `;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(BackfillScenarioPanelMinSampleCount1806000000000.SQL);
  }

  public async down(): Promise<void> {
    // Leaving the key in place is harmless: it is what the pipeline writes on new rows.
  }
}
