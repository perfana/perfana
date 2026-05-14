import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';
import { tryGetGrafanaConfig } from '../config/grafana-config-cache.js';
import {
  getApplicationDashboardsForTestRun,
  getGrafanaDashboardsForApplicationDashboards,
  getBenchmarksForTestRun,
  createPanelDocuments,
  PerfanaData
} from './panels/helpers.js';

export class PanelsPipeline extends BasePipelineTypeORM {
  async execute(input: { testRunId: string; includeDynatrace?: boolean }): Promise<PipelineResult> {
    const { testRunId, includeDynatrace = true } = input;
    this.logger.info(`🚀 Starting panels pipeline for test run ${testRunId}`);

    const overallStartTime = Date.now();

    try {
      // Soft-skip when no Grafana instance is configured. Grafana is documented
      // as an optional metric source; without one, there are no panels to build,
      // but downstream stages (rollup, statistics, checks) still need to run on
      // the load-test data already in TimescaleDB. See issue #282.
      const grafanaConfig = await tryGetGrafanaConfig();
      if (!grafanaConfig) {
        this.logger.info('No Grafana instance configured — skipping panels-processing');
        return {
          success: true,
          duration: Date.now() - overallStartTime,
          data: { skipped: 'no-grafana-configured' },
        };
      }

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_panels']);

      // Step 1: Load all data using TypeORM
      let stepStart = Date.now();
      this.logger.info(`⏱️  [TIMING] Starting test run query at ${new Date().toISOString()}`);

      const queryStart = Date.now();
      const testRun = await this.db.getTestRunByTestRunId(testRunId);
      const queryEnd = Date.now();

      this.logger.info(`⏱️  [TIMING] Query execution completed in ${queryEnd - queryStart}ms`);
      this.logger.info(`⏱️  [TIMING] Total time from step start: ${queryEnd - stepStart}ms`);

      if (!testRun) {
        throw new Error(`Test run not found: ${testRunId}`);
      }

      this.logger.info(`🔍 Test run loaded: ${Date.now() - stepStart}ms`);

      // Load system name for template variables
      stepStart = Date.now();
      const systemUnderTestName = await this.db.getSystemUnderTestName(testRun.systemUnderTestId) || 'unknown';
      this.logger.info(`🖥️  System name loaded: ${Date.now() - stepStart}ms`);

      // Create snake_case adapter for helpers (they expect snake_case properties)
      const testRunAdapter = {
        system_under_test_id: testRun.systemUnderTestId,
        test_environment: testRun.testEnvironment,
        workload: testRun.workload,
        test_run_id: testRun.testRunId,
        start_time: testRun.startTime!,
        end_time: testRun.endTime!,
        organization_id: testRun.organizationId || null,
      };

      // Create Pool-compatible adapter for helpers
      // Helpers expect pool.query() to return {rows: [...]}
      // but WorkerDatabaseService.query() returns the array directly
      const poolAdapter = {
        query: async (sql: string, params?: unknown[]) => {
          const rows = await this.db.query(sql, params);
          return { rows };
        }
      };

      // Find application dashboards using helper (helpers use pool.query() for raw SQL)
      stepStart = Date.now();
      const applicationDashboards = await getApplicationDashboardsForTestRun(poolAdapter, testRunAdapter);
      const appDashTime = Date.now() - stepStart;
      this.logger.info(`🎯 Found ${applicationDashboards.length} application dashboards: ${appDashTime}ms`);

      // Find grafana dashboards
      stepStart = Date.now();
      const grafanaDashboards = await getGrafanaDashboardsForApplicationDashboards(
        poolAdapter,
        applicationDashboards
      );
      const grafanaDashTime = Date.now() - stepStart;
      this.logger.info(`📈 Found ${grafanaDashboards.length} grafana dashboards: ${grafanaDashTime}ms`);

      // Find benchmarks
      stepStart = Date.now();
      const benchmarks = await getBenchmarksForTestRun(poolAdapter, testRunAdapter);
      const benchmarksTime = Date.now() - stepStart;
      this.logger.info(`🎯 Found ${benchmarks.length} benchmarks: ${benchmarksTime}ms`);

      // Step 2: Create PerfanaData object
      stepStart = Date.now();
      const perfanaData: PerfanaData = {
        test_run_id: testRunId,
        test_run: testRunAdapter as unknown as PerfanaData['test_run'],
        application_dashboards: applicationDashboards,
        benchmarks: benchmarks,
        dashboards: grafanaDashboards
      };
      this.logger.info(`📦 PerfanaData object created: ${Date.now() - stepStart}ms`);

      // Step 3: Create panel documents (with Grafana API calls, no DB connection held)
      stepStart = Date.now();
      const panelDocuments = await createPanelDocuments(perfanaData, systemUnderTestName);
      const createDocsTime = Date.now() - stepStart;
      this.logger.info(`🔧 Created ${panelDocuments.length} panel documents (filtered): ${createDocsTime}ms`);

      // Step 4: Save panel documents using TypeORM transaction
      await this.withTransaction(async (manager: EntityManager) => {
        stepStart = Date.now();
        this.logger.info('💾 Saving panel documents...');

        // Delete existing panels for this test run
        const deleteResult = await manager.query(
          'DELETE FROM ds_panels WHERE test_run_id = $1',
          [testRunId]
        );
        this.logger.info(`🗑️  Deleted ${deleteResult[1] || 0} existing panel documents`);

        // Insert new panel documents using bulk insert
        if (panelDocuments.length > 0) {
          await this.insertPanelDocuments(manager, panelDocuments, testRun);
          const saveTime = Date.now() - stepStart;
          this.logger.info(`💾 Saved ${panelDocuments.length} panel documents: ${saveTime}ms`);
        }
      });

      // TODO: Process Dynatrace dashboards if enabled
      if (includeDynatrace) {
        this.logger.info('⚠️  Dynatrace processing not yet implemented');
      }

      const totalTime = Date.now() - overallStartTime;

      // Performance summary
      this.logger.info('📊 PERFORMANCE SUMMARY:');
      this.logger.info(`  📈 Grafana dashboards lookup: ${grafanaDashTime}ms`);
      this.logger.info(`  🔧 Panel documents creation: ${createDocsTime}ms`);
      this.logger.info(`  🎯 Application dashboards: ${appDashTime}ms`);
      this.logger.info(`  🎯 Benchmarks lookup: ${benchmarksTime}ms`);
      this.logger.info(`  ⚡ TOTAL TIME: ${totalTime}ms`);
      this.logger.info(`✅ Pipeline completed successfully for ${testRunId}`);

      return {
        success: true,
        duration: totalTime,
        data: {
          panelDocuments: panelDocuments.length,
          applicationDashboards: applicationDashboards.length,
          grafanaDashboards: grafanaDashboards.length,
          benchmarks: benchmarks.length
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ Panels pipeline failed for ${testRunId}: ${errorMessage}`);

      return {
        success: false,
        error: {
          message: errorMessage,
          code: 'PANELS_PIPELINE_ERROR'
        }
      };
    }
  }

  private async insertPanelDocuments(manager: EntityManager, panelDocuments: unknown[], testRun: { organizationId?: string | null; teamId?: string | null }): Promise<void> {
    if (panelDocuments.length === 0) {return;}

    const columns = [
      'test_run_id', 'application_dashboard_id', 'metrics_source_id', 'dashboard_uid', 'panel_id',
      'panel_title', 'dashboard_label', 'benchmark_ids', 'panel',
      'query_variables', 'datasource_type', 'requests', 'errors', 'warnings', 'updated_at',
      'organization_id', 'team_id', 'created_by', 'updated_by'
    ];

    // Build VALUES clause for batch insert: ($1, $2, ...), ($15, $16, ...), ...
    const values = panelDocuments.map((_, index) =>
      `(${columns.map((_, colIndex) => `$${index * columns.length + colIndex + 1}`).join(', ')})`
    ).join(', ');

    const insertQuery = `
      INSERT INTO ds_panels (${columns.join(', ')})
      VALUES ${values}
    `;

    // Flatten all parameters into a single array
    const params = panelDocuments.flatMap(doc => {
      const d = doc as Record<string, unknown>;
      return [
        d.test_run_id,
        d.application_dashboard_id,
        d.metrics_source_id || null,
        d.dashboard_uid,
        d.panel_id,
        d.panel_title,
        d.dashboard_label,
        d.benchmark_ids, // Pass array directly to PostgreSQL (text[] column)
        JSON.stringify(d.panel),
        JSON.stringify(d.query_variables),
        d.datasource_type,
        JSON.stringify(d.requests),
        JSON.stringify(d.errors),
        JSON.stringify(d.warnings),
        d.updated_at,
        testRun.organizationId || null,
        testRun.teamId || null,
        'worker-pipeline',
        'worker-pipeline'
      ];
    });

    await manager.query(insertQuery, params);
  }

  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {
      return false;
    }

    const inputObj = input as { testRunId?: unknown };
    return typeof inputObj.testRunId === 'string' && inputObj.testRunId.length > 0;
  }
}
