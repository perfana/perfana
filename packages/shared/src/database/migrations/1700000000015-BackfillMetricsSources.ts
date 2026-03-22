import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.2.1: Backfill MetricsSource records from existing ApplicationDashboard data.
 *
 * For each ApplicationDashboard, creates a corresponding MetricsSource with:
 * - source_type inferred from dashboard_uid prefix (dynatrace-, performance-test-metrics-, else grafana)
 * - source_config_id = grafana_instance_id for grafana type, NULL otherwise
 * - external_ref = dashboard_uid
 * - All ownership/RBAC fields copied from ApplicationDashboard
 *
 * Then updates all 13 regular downstream tables and ds_metrics (chunk-by-chunk for TimescaleDB).
 *
 * Known limitation: prefix-based source_type inference may misclassify edge-case dashboard names.
 * Acceptable for one-time backfill; new data uses explicit source_type.
 */
export class BackfillMetricsSources1700000000015 implements MigrationInterface {
  name = 'BackfillMetricsSources1700000000015';

  private readonly regularDownstreamTables = [
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

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Insert MetricsSource rows from ApplicationDashboard data
    await queryRunner.query(`
      INSERT INTO metrics_sources (
        id,
        system_under_test_id,
        test_environment,
        source_type,
        source_config_id,
        external_ref,
        display_name,
        display_label,
        tags,
        organization_id,
        team_id,
        created_by,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
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

    // Step 2: Create temporary mapping table
    await queryRunner.query(`
      CREATE TEMP TABLE _ms_backfill_map AS
      SELECT
        ad.id AS application_dashboard_id,
        ms.id AS metrics_source_id
      FROM application_dashboards ad
      JOIN metrics_sources ms
        ON ms.system_under_test_id = ad.system_under_test_id
       AND ms.test_environment = ad.test_environment
       AND ms.external_ref = ad.dashboard_uid
       AND ms.display_name = ad.dashboard_name
       AND ms.source_type = CASE
          WHEN ad.dashboard_uid LIKE 'dynatrace-%' THEN 'dynatrace'
          WHEN ad.dashboard_uid LIKE 'performance-test-metrics-%' THEN 'performance_test'
          ELSE 'grafana'
        END
    `);

    await queryRunner.query(`
      CREATE INDEX idx_ms_backfill_map_ad ON _ms_backfill_map (application_dashboard_id)
    `);

    // Step 3: Update all regular downstream tables
    for (const table of this.regularDownstreamTables) {
      await queryRunner.query(`
        UPDATE "${table}" t
        SET metrics_source_id = m.metrics_source_id
        FROM _ms_backfill_map m
        WHERE t.application_dashboard_id = m.application_dashboard_id
          AND t.metrics_source_id IS NULL
      `);
    }

    // Step 4: Update ds_metrics (TimescaleDB hypertable) chunk-by-chunk
    await this.updateDsMetricsChunkByChunk(queryRunner);

    // Cleanup
    await queryRunner.query(`DROP TABLE IF EXISTS _ms_backfill_map`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NULL out metrics_source_id on all downstream tables
    for (const table of this.regularDownstreamTables) {
      await queryRunner.query(`
        UPDATE "${table}" SET metrics_source_id = NULL WHERE metrics_source_id IS NOT NULL
      `);
    }

    // NULL out ds_metrics chunk-by-chunk
    await this.nullDsMetricsChunkByChunk(queryRunner);

    // Delete backfilled MetricsSource rows (those that have a matching ApplicationDashboard via external_ref)
    await queryRunner.query(`
      DELETE FROM metrics_sources ms
      WHERE EXISTS (
        SELECT 1 FROM application_dashboards ad
        WHERE ad.dashboard_uid = ms.external_ref
          AND ad.system_under_test_id = ms.system_under_test_id
          AND ad.test_environment = ms.test_environment
      )
    `);
  }

  private async updateDsMetricsChunkByChunk(queryRunner: QueryRunner): Promise<void> {
    // Check if ds_metrics has any data and if TimescaleDB is available
    const chunks = await queryRunner.query(`
      SELECT chunk_schema, chunk_name, is_compressed
      FROM timescaledb_information.chunks
      WHERE hypertable_name = 'ds_metrics'
      ORDER BY range_start
    `).catch(() => []);

    if (!chunks || chunks.length === 0) {
      // No chunks = no data or no TimescaleDB; try direct update
      await queryRunner.query(`
        UPDATE ds_metrics t
        SET metrics_source_id = m.metrics_source_id
        FROM _ms_backfill_map m
        WHERE t.application_dashboard_id = m.application_dashboard_id
          AND t.metrics_source_id IS NULL
      `).catch(() => {
        // Table might be empty or not exist as hypertable yet
      });
      return;
    }

    for (const chunk of chunks) {
      const chunkFqn = `"${chunk.chunk_schema}"."${chunk.chunk_name}"`;

      if (chunk.is_compressed) {
        await queryRunner.query(`SELECT decompress_chunk('${chunkFqn}')`);
      }

      await queryRunner.query(`
        UPDATE ${chunkFqn} t
        SET metrics_source_id = m.metrics_source_id
        FROM _ms_backfill_map m
        WHERE t.application_dashboard_id = m.application_dashboard_id
          AND t.metrics_source_id IS NULL
      `);

      if (chunk.is_compressed) {
        await queryRunner.query(`SELECT compress_chunk('${chunkFqn}')`);
      }
    }
  }

  private async nullDsMetricsChunkByChunk(queryRunner: QueryRunner): Promise<void> {
    const chunks = await queryRunner.query(`
      SELECT chunk_schema, chunk_name, is_compressed
      FROM timescaledb_information.chunks
      WHERE hypertable_name = 'ds_metrics'
      ORDER BY range_start
    `).catch(() => []);

    if (!chunks || chunks.length === 0) {
      await queryRunner.query(`
        UPDATE ds_metrics SET metrics_source_id = NULL WHERE metrics_source_id IS NOT NULL
      `).catch(() => {});
      return;
    }

    for (const chunk of chunks) {
      const chunkFqn = `"${chunk.chunk_schema}"."${chunk.chunk_name}"`;

      if (chunk.is_compressed) {
        await queryRunner.query(`SELECT decompress_chunk('${chunkFqn}')`);
      }

      await queryRunner.query(`
        UPDATE ${chunkFqn} SET metrics_source_id = NULL WHERE metrics_source_id IS NOT NULL
      `);

      if (chunk.is_compressed) {
        await queryRunner.query(`SELECT compress_chunk('${chunkFqn}')`);
      }
    }
  }
}
