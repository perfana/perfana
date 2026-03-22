import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.7.1 + 3.7.5: MetricsSource 1:1 granularity + nullable Grafana columns
 *
 * Two changes in one migration:
 *
 * 1. Re-backfill MetricsSource to 1:1 with ApplicationDashboard by adding
 *    display_label to the unique constraint. Previously MetricsSource was at
 *    template level (e.g., one "JVM" MetricsSource for both "JVM afterburner-be"
 *    and "JVM afterburner-fe"). Now each label gets its own MetricsSource.
 *    This eliminates the fan-out problem in COALESCE JOINs.
 *
 * 2. Make grafana_instance_id and grafana_dashboard_id nullable on
 *    application_dashboards. Non-Grafana sources (Dynatrace, performance_test)
 *    no longer need synthetic GrafanaDashboard records. For open-source users
 *    starting with a fresh database, no fake Grafana records are created.
 */
export class MetricsSourceOneToOneAndNullableGrafana1700000000017 implements MigrationInterface {
  name = 'MetricsSourceOneToOneAndNullableGrafana1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Part 1: MetricsSource 1:1 granularity ──

    // Drop old unique constraint (template-level: sut, env, source_type, external_ref, display_name)
    await queryRunner.query(`
      ALTER TABLE metrics_sources DROP CONSTRAINT IF EXISTS uq_metrics_sources_unique
    `);

    // Create new unique constraint including display_label (instance-level)
    await queryRunner.query(`
      ALTER TABLE metrics_sources
      ADD CONSTRAINT uq_metrics_sources_unique
      UNIQUE (system_under_test_id, test_environment, source_type, external_ref, display_name, display_label)
    `);

    // Re-backfill: create one MetricsSource per ApplicationDashboard (where missing)
    await queryRunner.query(`
      INSERT INTO metrics_sources (
        system_under_test_id, test_environment, source_type, source_config_id,
        external_ref, display_name, display_label, tags,
        organization_id, team_id, created_by, created_at, updated_at
      )
      SELECT
        ad.system_under_test_id,
        ad.test_environment,
        CASE
          WHEN ad.dashboard_uid LIKE 'dynatrace-%' THEN 'dynatrace'
          WHEN ad.dashboard_uid LIKE 'performance-test-metrics-%' THEN 'performance_test'
          ELSE 'grafana'
        END,
        CASE
          WHEN ad.dashboard_uid NOT LIKE 'dynatrace-%'
           AND ad.dashboard_uid NOT LIKE 'performance-test-metrics-%'
          THEN ad.grafana_instance_id
          ELSE NULL
        END,
        ad.dashboard_uid,
        ad.dashboard_name,
        ad.dashboard_label,
        ad.tags,
        ad.organization_id,
        ad.team_id,
        ad.created_by,
        COALESCE(ad.created_at, NOW()),
        COALESCE(ad.updated_at, NOW())
      FROM application_dashboards ad
      ON CONFLICT ON CONSTRAINT uq_metrics_sources_unique DO NOTHING
    `);

    // Update forward links: set metrics_source_id on application_dashboards
    // that now have a 1:1 MetricsSource (matching by display_label too)
    await queryRunner.query(`
      UPDATE application_dashboards ad
      SET metrics_source_id = ms.id
      FROM metrics_sources ms
      WHERE ms.system_under_test_id = ad.system_under_test_id
        AND ms.test_environment = ad.test_environment
        AND ms.external_ref = ad.dashboard_uid
        AND ms.display_name = ad.dashboard_name
        AND ms.display_label = ad.dashboard_label
        AND ms.source_type = CASE
          WHEN ad.dashboard_uid LIKE 'dynatrace-%' THEN 'dynatrace'
          WHEN ad.dashboard_uid LIKE 'performance-test-metrics-%' THEN 'performance_test'
          ELSE 'grafana'
        END
    `);

    // Update downstream tables: set metrics_source_id from ApplicationDashboard's new 1:1 link
    const downstreamTables = [
      'benchmarks',
      'compare_filter_presets',
      'ds_adapt_results',
      'ds_adapt_tracked_results',
      'ds_change_points',
      'ds_compare_config',
      'ds_control_group_statistics',
      'ds_metric_statistics',
      'ds_panels',
      'ds_tracked_differences',
      'dynatrace_queries',
      'provisioned_template_ds_compare_configs',
      'trends_filter_presets',
    ];

    for (const table of downstreamTables) {
      await queryRunner.query(`
        UPDATE "${table}" t
        SET metrics_source_id = ad.metrics_source_id
        FROM application_dashboards ad
        WHERE t.application_dashboard_id = ad.id
          AND ad.metrics_source_id IS NOT NULL
          AND (t.metrics_source_id IS NULL OR t.metrics_source_id != ad.metrics_source_id)
      `);
    }

    // Update ds_metrics chunk-by-chunk (TimescaleDB hypertable)
    const chunks = await queryRunner.query(`
      SELECT chunk_schema, chunk_name, is_compressed
      FROM timescaledb_information.chunks
      WHERE hypertable_name = 'ds_metrics'
      ORDER BY range_start
    `).catch(() => []);

    if (chunks && chunks.length > 0) {
      for (const chunk of chunks) {
        const chunkFqn = `"${chunk.chunk_schema}"."${chunk.chunk_name}"`;
        if (chunk.is_compressed) {
          await queryRunner.query(`SELECT decompress_chunk('${chunkFqn}')`);
        }
        await queryRunner.query(`
          UPDATE ${chunkFqn} t
          SET metrics_source_id = ad.metrics_source_id
          FROM application_dashboards ad
          WHERE t.application_dashboard_id = ad.id
            AND ad.metrics_source_id IS NOT NULL
            AND (t.metrics_source_id IS NULL OR t.metrics_source_id != ad.metrics_source_id)
        `);
        if (chunk.is_compressed) {
          await queryRunner.query(`SELECT compress_chunk('${chunkFqn}')`);
        }
      }
    } else {
      // No chunks or no TimescaleDB — direct update
      await queryRunner.query(`
        UPDATE ds_metrics t
        SET metrics_source_id = ad.metrics_source_id
        FROM application_dashboards ad
        WHERE t.application_dashboard_id = ad.id
          AND ad.metrics_source_id IS NOT NULL
          AND (t.metrics_source_id IS NULL OR t.metrics_source_id != ad.metrics_source_id)
      `).catch(() => {});
    }

    // ── Part 2: Nullable Grafana columns ──

    // Make grafana columns nullable so non-Grafana sources don't need fake records
    await queryRunner.query(`
      ALTER TABLE application_dashboards ALTER COLUMN grafana_instance_id DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE application_dashboards ALTER COLUMN grafana_dashboard_id DROP NOT NULL
    `);

    // Add partial unique index for non-Grafana dashboards
    // (the existing unique constraint covers Grafana dashboards where grafana_instance_id IS NOT NULL)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_application_dashboards_non_grafana
      ON application_dashboards (system_under_test_id, test_environment, dashboard_uid, dashboard_label)
      WHERE grafana_instance_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove non-Grafana unique index
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_application_dashboards_non_grafana
    `);

    // Restore NOT NULL (only safe if no NULL values exist)
    // For safety, set any NULLs to a placeholder first
    const grafanaInstance = await queryRunner.query(`SELECT id FROM grafana_instances LIMIT 1`);
    if (grafanaInstance.length > 0) {
      const giId = grafanaInstance[0].id;
      await queryRunner.query(`
        UPDATE application_dashboards SET grafana_instance_id = '${giId}'
        WHERE grafana_instance_id IS NULL
      `);
    }

    await queryRunner.query(`
      ALTER TABLE application_dashboards ALTER COLUMN grafana_instance_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE application_dashboards ALTER COLUMN grafana_dashboard_id SET NOT NULL
    `);

    // Restore old unique constraint (without display_label)
    await queryRunner.query(`
      ALTER TABLE metrics_sources DROP CONSTRAINT IF EXISTS uq_metrics_sources_unique
    `);
    await queryRunner.query(`
      ALTER TABLE metrics_sources
      ADD CONSTRAINT uq_metrics_sources_unique
      UNIQUE (system_under_test_id, test_environment, source_type, external_ref, display_name)
    `);
  }
}
