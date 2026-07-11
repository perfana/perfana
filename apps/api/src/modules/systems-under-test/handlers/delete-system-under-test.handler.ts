import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SystemUnderTest, OwnedResource } from '@perfana/shared/entities';
import { ResourceNotFoundException, DatabaseException } from '../../../common/exceptions/business.exception';
import { AuditService } from '../../audit/audit.service';

export interface DeletePreviewResult {
  systemName: string;
  counts: {
    testRuns: number;
    applicationDashboards: number;
    benchmarks: number;
    deepLinks: number;
    events: number;
    expectedConfigChanges: number;
    tracingServices: number;
    notificationChannels: number;
    dynatraceEntityMappings: number;
    dsMetrics: number;
    dsChangePoints: number;
    dsControlGroups: number;
    checkResults: number;
    testRunConfigs: number;
    requestsRaw: number;
    transactions: number;
    transactionStats: number;
    apdexThresholds: number;
    graphPresets: number;
    filterPresets: number;
  };
}

@Injectable()
export class DeleteSystemUnderTestHandler {
  private readonly logger = new Logger(DeleteSystemUnderTestHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns counts of all related resources that will be deleted.
   */
  async getDeletePreview(sutId: string): Promise<DeletePreviewResult> {
    const sut = await this.dataSource.query(
      `SELECT id, name FROM systems_under_test WHERE id = $1`,
      [sutId],
    );

    if (!sut || sut.length === 0) {
      throw new ResourceNotFoundException('SystemUnderTest', sutId);
    }

    const systemName = sut[0].name;

    // Count all related resources
    const countQuery = async (sql: string, params: string[] = [sutId]): Promise<number> => {
      const result = await this.dataSource.query(sql, params);
      return parseInt(result[0]?.count ?? '0', 10);
    };

    const [
      testRuns,
      applicationDashboards,
      benchmarks,
      deepLinks,
      events,
      expectedConfigChanges,
      tracingServices,
      notificationChannels,
      dynatraceEntityMappings,
      dsMetrics,
      dsChangePoints,
      dsControlGroups,
      checkResults,
      testRunConfigs,
      requestsRaw,
      transactions,
      transactionStats,
      apdexThresholds,
      graphPresets,
      filterPresets,
    ] = await Promise.all([
      countQuery(`SELECT COUNT(*) FROM test_runs WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM application_dashboards WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM benchmarks WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM deep_links WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM events WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM expected_config_changes WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM tracing_services WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM notification_channels WHERE system_under_test_id = $1`),
      countQuery(`SELECT COUNT(*) FROM dynatrace_entity_mappings WHERE system_under_test_id = $1`),
      countQuery(
        `SELECT COUNT(*) FROM ds_metrics WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`,
      ),
      countQuery(
        `SELECT COUNT(*) FROM ds_change_points WHERE system_under_test_id = $1`,
        [sutId],
      ),
      countQuery(
        `SELECT COUNT(*) FROM ds_control_groups WHERE system_under_test_id = $1`,
        [sutId],
      ),
      countQuery(
        `SELECT COUNT(*) FROM check_results WHERE system_under_test_id = $1`,
      ),
      countQuery(
        `SELECT COUNT(*) FROM test_run_configs WHERE test_run_id IN (SELECT id FROM test_runs WHERE system_under_test_id = $1)`,
      ),
      countQuery(
        `SELECT COUNT(*) FROM requests_raw WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`,
      ),
      countQuery(
        `SELECT COUNT(*) FROM transactions WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`,
      ),
      countQuery(
        `SELECT COUNT(*) FROM test_run_transaction_stats WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`,
      ),
      countQuery(
        `SELECT (SELECT COUNT(*) FROM workload_apdex_thresholds WHERE system_under_test_id = $1) + (SELECT COUNT(*) FROM workload_transaction_apdex_thresholds WHERE system_under_test_id = $1) AS count`,
      ),
      countQuery(
        `SELECT COUNT(*) FROM graph_presets WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`,
      ),
      countQuery(
        `SELECT (SELECT COUNT(*) FROM trends_filter_presets WHERE application_dashboard_id IN (SELECT id FROM application_dashboards WHERE system_under_test_id = $1)) + (SELECT COUNT(*) FROM compare_filter_presets WHERE application_dashboard_id IN (SELECT id FROM application_dashboards WHERE system_under_test_id = $1)) AS count`,
      ),
    ]);

    return {
      systemName,
      counts: {
        testRuns,
        applicationDashboards,
        benchmarks,
        deepLinks,
        events,
        expectedConfigChanges,
        tracingServices,
        notificationChannels,
        dynatraceEntityMappings,
        dsMetrics,
        dsChangePoints,
        dsControlGroups,
        checkResults,
        testRunConfigs,
        requestsRaw,
        transactions,
        transactionStats,
        apdexThresholds,
        graphPresets,
        filterPresets,
      },
    };
  }

  /**
   * Execute cascading delete of a system under test and ALL related data.
   */
  async execute(sutId: string): Promise<{ success: boolean; systemName: string }> {
    // Verify the SUT exists — load the full row so the audit diff captures
    // the pre-delete name + organization_id (auditableFields = ['name']).
    const sutRows = await this.dataSource.query(
      `SELECT id, name, organization_id, team_id FROM systems_under_test WHERE id = $1`,
      [sutId],
    );

    if (!sutRows || sutRows.length === 0) {
      throw new ResourceNotFoundException('SystemUnderTest', sutId);
    }

    const systemName = sutRows[0].name as string;
    this.logger.log(`Starting cascade deletion for system under test "${systemName}" (${sutId})`);

    // Phase 5a — log DELETE before the cascade transaction so the audit row
    // captures the pre-delete state (mirrors PR8 / PR10 / PR14 ordering).
    // Cascaded child rows (test_runs, application_dashboards, environments,
    // workloads, …) are intentionally not individually audited — they are
    // implied by the SUT-DELETE row, and the raw `manager.query('DELETE …')`
    // calls below would not surface to the audit lint rule's matcher anyway.
    const sutRef = Object.assign(new SystemUnderTest(), {
      id: sutId,
      name: systemName,
      organization_id: sutRows[0].organization_id as string | undefined,
      team_id: sutRows[0].team_id as string | undefined,
    });
    this.auditService.logDelete(sutRef as unknown as OwnedResource);

    try {
      await this.dataSource.transaction(async (manager) => {
        // Phase 1 — DS tables referencing test_run_id (via subquery)
        await this.deletePhase1_DsTestRunTables(manager, sutId);

        // Phase 2 — DS tables referencing system_under_test_id directly
        await this.deletePhase2_DsSutTables(manager, sutId);

        // Phase 3 — Test run child tables + hypertables
        await this.deletePhase3_TestRunChildData(manager, sutId);

        // Phase 4 — Test runs themselves
        await this.deleteWithLog(manager, 'test_runs', `DELETE FROM test_runs WHERE system_under_test_id = $1`, [sutId]);

        // Phase 5 — Dashboard chain (application_dashboards; grafana_dashboards are shared and not deleted)
        await this.deleteWithLog(manager, 'application_dashboards', `DELETE FROM application_dashboards WHERE system_under_test_id = $1`, [sutId]);

        // Phase 6 — Other SUT-linked tables
        await this.deletePhase6_OtherSutTables(manager, sutId);

        // Phase 7 — The SUT itself
        await this.deleteWithLog(manager, 'systems_under_test', `DELETE FROM systems_under_test WHERE id = $1`, [sutId]);
      });

      this.logger.log(`Successfully deleted system under test "${systemName}" (${sutId})`);
      return { success: true, systemName };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete system under test ${sutId}:`, error);
      throw new DatabaseException('Failed to delete system under test', error);
    }
  }

  /**
   * Phase 1: Delete DS tables that reference test_run_id (string) via test_runs subquery.
   * These have NO ACTION FKs on application_dashboard_id, so must be deleted before app dashboards.
   */
  private async deletePhase1_DsTestRunTables(
    manager: EntityManager,
    sutId: string,
  ): Promise<void> {
    // Tables with varchar test_run_id
    const stringTestRunTables = [
      'ds_adapt_results',
      'ds_adapt_conclusion',
      'ds_adapt_tracked_results',
      'ds_change_points',
      'check_results',
      'ds_metric_statistics',
      'ds_metric_collection_status',
      'ds_panels',
    ];

    for (const table of stringTestRunTables) {
      await this.deleteWithLog(
        manager,
        table,
        `DELETE FROM ${table} WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`,
        [sutId],
      );
    }

    // Tables with UUID test_run_id
    const uuidTestRunTables = [
      'ds_query_executions',
      'ds_tracked_differences',
    ];

    for (const table of uuidTestRunTables) {
      await this.deleteWithLog(
        manager,
        table,
        `DELETE FROM ${table} WHERE test_run_id IN (SELECT id FROM test_runs WHERE system_under_test_id = $1)`,
        [sutId],
      );
    }
  }

  /**
   * Phase 2: Delete DS tables that reference system_under_test_id directly.
   * Control group statistics must be deleted before control groups.
   */
  private async deletePhase2_DsSutTables(
    manager: EntityManager,
    sutId: string,
  ): Promise<void> {
    // Delete control group statistics first (FK on control_group_id)
    await this.deleteWithLog(
      manager,
      'ds_control_group_statistics',
      `DELETE FROM ds_control_group_statistics WHERE control_group_id IN (SELECT control_group_id FROM ds_control_groups WHERE system_under_test_id = $1)`,
      [sutId],
    );

    await this.deleteWithLog(
      manager,
      'ds_control_groups',
      `DELETE FROM ds_control_groups WHERE system_under_test_id = $1`,
      [sutId],
    );

    await this.deleteWithLog(
      manager,
      'provisioned_template_ds_compare_configs',
      `DELETE FROM provisioned_template_ds_compare_configs WHERE system_under_test_id = $1`,
      [sutId],
    );

    await this.deleteWithLog(
      manager,
      'ds_compare_config',
      `DELETE FROM ds_compare_config WHERE system_under_test_id = $1`,
      [sutId],
    );
  }

  /**
   * Phase 3: Delete test run child data including hypertables and configs.
   */
  private async deletePhase3_TestRunChildData(
    manager: EntityManager,
    sutId: string,
  ): Promise<void> {
    const strSubq = `(SELECT test_run_id FROM test_runs WHERE system_under_test_id = $1)`;
    const uuidSubq = `(SELECT id FROM test_runs WHERE system_under_test_id = $1)`;

    // Hypertables (varchar test_run_id)
    await this.deleteWithLog(manager, 'ds_metrics', `DELETE FROM ds_metrics WHERE test_run_id IN ${strSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'requests_raw', `DELETE FROM requests_raw WHERE test_run_id IN ${strSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'requests_error', `DELETE FROM requests_error WHERE test_run_id IN ${strSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'transactions', `DELETE FROM transactions WHERE test_run_id IN ${strSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'virtual_users', `DELETE FROM virtual_users WHERE test_run_id IN ${strSubq}`, [sutId]);
    // Per-test-run transaction stats rollup (no FK — must be cleaned up explicitly, see #150/#151)
    await this.deleteWithLog(manager, 'test_run_transaction_stats', `DELETE FROM test_run_transaction_stats WHERE test_run_id IN ${strSubq}`, [sutId]);

    // test_run_configs has both UUID and string columns
    await this.deleteWithLog(manager, 'test_run_configs (by UUID)', `DELETE FROM test_run_configs WHERE test_run_id IN ${uuidSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'test_run_configs (by string)', `DELETE FROM test_run_configs WHERE test_run_id_string IN ${strSubq}`, [sutId]);

    // Tables with CASCADE FKs on test_runs (delete explicitly for logging/completeness)
    await this.deleteWithLog(manager, 'awr_reports', `DELETE FROM awr_reports WHERE test_run_id IN ${uuidSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'generated_reports', `DELETE FROM generated_reports WHERE test_run_id IN ${uuidSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'test_run_alerts', `DELETE FROM test_run_alerts WHERE test_run_id IN ${uuidSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'test_run_events', `DELETE FROM test_run_events WHERE test_run_id IN ${uuidSubq}`, [sutId]);

    // Graph presets linked via test_run_id (varchar)
    await this.deleteWithLog(manager, 'graph_presets', `DELETE FROM graph_presets WHERE test_run_id IN ${strSubq}`, [sutId]);
  }

  /**
   * Phase 6: Delete other SUT-linked tables.
   */
  private async deletePhase6_OtherSutTables(
    manager: EntityManager,
    sutId: string,
  ): Promise<void> {
    // Filter presets linked via application_dashboard_id
    const appDashSubq = `(SELECT id FROM application_dashboards WHERE system_under_test_id = $1)`;
    await this.deleteWithLog(manager, 'trends_filter_presets', `DELETE FROM trends_filter_presets WHERE application_dashboard_id IN ${appDashSubq}`, [sutId]);
    await this.deleteWithLog(manager, 'compare_filter_presets', `DELETE FROM compare_filter_presets WHERE application_dashboard_id IN ${appDashSubq}`, [sutId]);

    // Direct SUT FK tables (most have CASCADE, but delete explicitly for count/logging)
    const sutLinkedTables = [
      'benchmarks',
      'expected_config_changes',
      'events',
      'tracing_services',
      'deep_links',
      'notification_channels',
      'dynatrace_entity_mappings',
      'dynatrace_queries',
      'workload_apdex_thresholds',
      'workload_transaction_apdex_thresholds',
      'system_under_test_test_environments',
      'scaling_sessions',
      // metrics_sources FK is NO ACTION and must go last — DS tables, benchmarks,
      // application_dashboards, filter presets, and dynatrace_queries (all deleted
      // above) reference it.
      'metrics_sources',
    ];

    for (const table of sutLinkedTables) {
      await this.deleteWithLog(
        manager,
        table,
        `DELETE FROM ${table} WHERE system_under_test_id = $1`,
        [sutId],
      );
    }

    // alert_tag_filters uses SET NULL, but clear reference for clean delete
    await manager.query(
      `UPDATE alert_tag_filters SET system_under_test_id = NULL WHERE system_under_test_id = $1`,
      [sutId],
    );
    this.logger.log(`Cleared alert_tag_filters references for SUT ${sutId}`);
  }

  private async deleteWithLog(
    manager: EntityManager,
    label: string,
    sql: string,
    params?: string[],
  ): Promise<number> {
    const result = await manager.query(sql, params);
    const count = result?.[1] ?? 0;
    if (count > 0) {
      this.logger.log(`Deleted ${count} rows from ${label}`);
    }
    return count;
  }
}
