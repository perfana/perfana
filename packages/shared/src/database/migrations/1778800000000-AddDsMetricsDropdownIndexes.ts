import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add covering index on ds_metrics for the report-tab panel/metric dropdown.
 *
 * The dropdown query is:
 *   SELECT dashboard_label, panel_title, panel_id, unit,
 *          COUNT(DISTINCT metric_name),
 *          ARRAY_AGG(DISTINCT metric_name ORDER BY metric_name)
 *     FROM ds_metrics
 *    WHERE test_run_id = $1
 *    GROUP BY dashboard_label, panel_title, panel_id, unit
 *    ORDER BY dashboard_label, panel_title;
 *
 * Before: ~40,000 ms (heap scan over millions of rows on a populated test run,
 *         spilling 280 MB to sort+DISTINCT-dedupe down to ~19 panel rows).
 * After:    ~542 ms (Index Only Scan → streaming GroupAggregate, ~75× faster).
 *
 * NEW INDEX:
 * - idx_ds_metrics_panel_lookup
 *     (test_run_id, dashboard_label, panel_title, panel_id, unit, metric_name)
 *
 *   Column order is deliberate and matches the query's WHERE → GROUP BY →
 *   ORDER BY exactly:
 *     - test_run_id           — equality predicate (WHERE)
 *     - dashboard_label,
 *       panel_title,
 *       panel_id,
 *       unit                  — GROUP BY columns (also satisfies ORDER BY
 *                                via the leading dashboard_label, panel_title)
 *     - metric_name           — included so DISTINCT/ARRAY_AGG can be answered
 *                                from the index without heap fetches
 *
 *   If a future query changes the GROUP BY column order, this index needs to
 *   be reconsidered.
 *
 * NOT NEEDED:
 *   The series dropdown query (`SELECT DISTINCT metric_name FROM ds_metrics
 *   WHERE panel_id = $1 AND application_dashboard_id = $2`) is already
 *   covered by the existing `idx_ds_metrics_dashboard_panel_metric_time`
 *   on (application_dashboard_id, panel_id, metric_name, "time" DESC). The
 *   leading two columns match the predicate and metric_name is included, so
 *   the planner picks an Index Only Scan there too.
 *
 * STORAGE:
 *   ~80 MB per chunk on the lab profile (≈1 day per chunk). At that rate the
 *   index adds ≈30 GB / month per environment. Operators may want to add a
 *   TimescaleDB compression policy for older chunks alongside this change.
 *
 * TIMESCALEDB CAVEAT:
 *   ds_metrics is a TimescaleDB hypertable, which does NOT support
 *   `CREATE INDEX CONCURRENTLY`. Plain `CREATE INDEX` will lock each chunk
 *   briefly while building (a few seconds per chunk in production; ≈20–60 s
 *   on the populated lab). Plan accordingly when applying in production.
 */
export class AddDsMetricsDropdownIndexes1778800000000 implements MigrationInterface {
  name = 'AddDsMetricsDropdownIndexes1778800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ds_metrics_panel_lookup
        ON ds_metrics
        USING btree (test_run_id, dashboard_label, panel_title, panel_id, unit, metric_name)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_panel_lookup`);
  }
}
