import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';
import { getConfig } from '../config/environment.js';
import { DynatraceRepository } from '../services/dynatrace/DynatraceRepository.js';
import { QueryConstructor } from '../services/dynatrace/QueryConstructor.js';
import { DynatraceAPIClient } from '../services/dynatrace/DynatraceAPIClient.js';
import { DataProcessor } from '../services/dynatrace/DataProcessor.js';
import {
  DynatraceQueryConfig,
  DynatraceQueryResult,
  PanelDocument,
  PanelMetricsDocument
} from '../types/dynatrace/index.js';

/**
 * Dynatrace Pipeline - Metrics Collection
 *
 * Collects metrics from Dynatrace using:
 * - DQL (Dynatrace Query Language) for SaaS instances
 * - Metrics API v2 selectors for Managed instances
 * Based on Python implementation: pipeline.py
 *
 * Pipeline stages:
 * 1. Load query configurations from database (dynatrace_dql table)
 * 2. Replace time range placeholders with actual test run times
 * 3. Execute queries via appropriate Dynatrace API endpoint
 * 4. Process query results into panel and metrics documents
 * 5. Store documents in ds_panels, panel_metrics, and metrics tables
 */

export interface DynatraceInput {
  testRunIds: string[];
}

export class DynatracePipeline extends BasePipelineTypeORM {
  private repository: DynatraceRepository;
  private queryConstructor: QueryConstructor;
  private dataProcessor: DataProcessor;
  private config = getConfig();

  constructor(logger: unknown) {
    super(logger);
    // DynatraceRepository migrated to use TypeORM WorkerDatabaseService
    this.repository = new DynatraceRepository(this.db);
    this.queryConstructor = new QueryConstructor(this.repository);
    this.dataProcessor = new DataProcessor();
  }

  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as unknown;
    return Array.isArray(typedInput.testRunIds) &&
           typedInput.testRunIds.length > 0 &&
           typedInput.testRunIds.every((id: unknown) => typeof id === 'string');
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    if (!this.validateInput(input)) {
      return this.createErrorResult('Invalid input: expected { testRunIds: string[] }', 'INVALID_INPUT');
    }

    const { testRunIds } = input as DynatraceInput;

    try {
      this.logger.info(`Starting Dynatrace DQL metrics collection for test runs: ${testRunIds.join(', ')}`);

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_panels']);

      let totalPanels = 0;
      let totalMetrics = 0;
      let totalQueries = 0;

      // Process each test run
      for (const testRunId of testRunIds) {
        const result = await this.collectDynatraceMetrics(testRunId);
        totalPanels += result.panelCount;
        totalMetrics += result.metricsCount;
        totalQueries += result.queryCount;
      }

      const duration = Date.now() - startTime;
      this.logPerformance('dynatrace-dql-collection', startTime, {
        testRunCount: testRunIds.length,
        totalQueries,
        totalPanels,
        totalMetrics
      });

      return this.createSuccessResult({
        testRunCount: testRunIds.length,
        totalQueries,
        totalPanels,
        totalMetrics
      }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { testRunIds });
      return this.createErrorResult(
        error as Error,
        'DYNATRACE_DQL_COLLECTION_FAILED',
        { testRunIds },
        duration
      );
    }
  }

  /**
   * Collect Dynatrace metrics for a single test run
   */
  private async collectDynatraceMetrics(testRunId: string): Promise<{
    panelCount: number;
    metricsCount: number;
    queryCount: number;
  }> {
    this.logger.info(`Processing Dynatrace DQL queries for test run ${testRunId}`);

    // Step 1: Load test run details
    const testRun = await this.loadTestRun(testRunId);

    // Step 2: Construct queries from database configurations
    const queries = await this.queryConstructor.constructQueriesFromDatabase({
      testRunId: testRun.testRunId,
      systemUnderTestId: testRun.systemUnderTestId,
      testEnvironment: testRun.testEnvironment,
      workload: testRun.workload,
      start: testRun.startTime || new Date(),
      end: testRun.endTime || new Date()
    });

    if (queries.length === 0) {
      this.logger.info(`No Dynatrace queries configured for ${testRun.systemUnderTestId}.${testRun.testEnvironment}.${testRun.workload}`);
      return { panelCount: 0, metricsCount: 0, queryCount: 0 };
    }

    // Step 3: Group queries by dynatraceConfigId (support multiple Dynatrace instances per test run)
    const queriesByConfig = new Map<string, DynatraceQueryConfig[]>();
    for (const query of queries) {
      if (!queriesByConfig.has(query.dynatraceConfigId)) {
        queriesByConfig.set(query.dynatraceConfigId, []);
      }
      queriesByConfig.get(query.dynatraceConfigId)!.push(query);
    }

    this.logger.info(`Found ${queriesByConfig.size} Dynatrace instance(s) to query`);

    // Step 4: Execute queries for each Dynatrace instance
    const allQueryResults: DynatraceQueryResult[] = [];

    for (const [dynatraceConfigId, configQueries] of queriesByConfig) {
      this.logger.info(`Loading Dynatrace config: ${dynatraceConfigId} (${configQueries.length} queries)`);
      const dynatraceConfig = await this.repository.getDynatraceConfigById(dynatraceConfigId);

      if (!dynatraceConfig) {
        this.logger.error(`Dynatrace configuration not found for id: ${dynatraceConfigId}, skipping ${configQueries.length} queries`);
        continue;
      }

      this.logger.info(`Using Dynatrace instance: ${dynatraceConfig.label} (${dynatraceConfig.host}), type: ${dynatraceConfig.dynatraceType}`);

      // Use tokens from database config, with fallback to environment variables
      const apiToken = dynatraceConfig.apiToken || this.config.DYNATRACE_API_TOKEN;
      const platformToken = dynatraceConfig.platformApiToken || this.config.DYNATRACE_PLATFORM_TOKEN;

      if (!apiToken) {
        this.logger.error(`Dynatrace API token not found in config ${dynatraceConfig.label}, skipping queries`);
        continue;
      }

      // Platform token is only required for SaaS instances (DQL queries)
      if (dynatraceConfig.dynatraceType === 'saas' && !platformToken) {
        this.logger.error(`Platform API token required for SaaS instance ${dynatraceConfig.label} but not configured, skipping queries`);
        continue;
      }

      const apiClient = new DynatraceAPIClient({
        host: dynatraceConfig.host,
        apiToken,
        platformToken: platformToken || '', // Empty string for managed instances
        dynatraceType: dynatraceConfig.dynatraceType,
        maxConcurrent: 5  // Execute queries with controlled concurrency
      });

      try {
        const configQueryResults = await this.executeQueries(
          apiClient,
          configQueries,
          testRun.startTime || new Date(),
          testRun.endTime || new Date()
        );

        allQueryResults.push(...configQueryResults);
      } finally {
        await apiClient.close();
      }
    }

    // Step 5: Process results into panel and metrics documents
    const { panelDocuments, metricsDocuments } = await this.dataProcessor.processDynatraceResults(
      allQueryResults,
      testRunId,
      testRun.endTime || new Date(),
      testRun
    );

    // Skip storage if no data was returned from Dynatrace
    if (metricsDocuments.length === 0) {
      this.logger.info(`No Dynatrace metrics found for test run ${testRunId} - skipping storage`);
      return {
        panelCount: 0,
        metricsCount: 0,
        queryCount: queries.length
      };
    }

    // Step 6: Store metrics documents in TimescaleDB
    await this.storeMetricsDocuments(metricsDocuments, testRunId, testRun);

    this.logger.info(`✅ Completed ${queries.length} Dynatrace queries: ${panelDocuments.length} panels, ${metricsDocuments.length} metrics docs`);

    // Track collection status per dynatrace config for gap detection by refresh-missing-data
    if (testRun.startTime && testRun.endTime) {
      for (const dynatraceConfigId of queriesByConfig.keys()) {
        try {
          await this.db.updateCollectedRanges(
            testRunId,
            'dynatrace',
            dynatraceConfigId,
            { from: testRun.startTime, to: testRun.endTime }
          );
          await this.db.markCollectionComplete(testRunId, 'dynatrace', dynatraceConfigId);
          this.logger.info(`📋 Collection status tracked: dynatrace/${dynatraceConfigId} marked complete`);
        } catch (statusError) {
          // Non-fatal: collection status tracking failure shouldn't fail the pipeline
          this.logger.warn(`⚠️ Failed to track collection status for dynatrace/${dynatraceConfigId}: ${statusError}`);
        }
      }
    }

    return {
      panelCount: panelDocuments.length,
      metricsCount: metricsDocuments.length,
      queryCount: queries.length
    };
  }

  /**
   * Execute queries via Dynatrace API (DQL for SaaS, Metrics API v2 for Managed)
   */
  private async executeQueries(
    apiClient: DynatraceAPIClient,
    queries: DynatraceQueryConfig[],
    startTime: Date,
    endTime: Date
  ): Promise<DynatraceQueryResult[]> {
    this.logger.info(`Executing ${queries.length} Dynatrace queries`);

    const results = await apiClient.executeBatchQueries(queries, startTime, endTime);

    // Transform API results to DynatraceQueryResult format
    return results.map((result, index) => {
      const queryConfig = queries[index];
      return {
        tileId: result.tileId,
        tileTitle: result.tileTitle,
        visualization: queryConfig.visualization,
        query: queryConfig.query,
        matchMetricPattern: queryConfig.matchMetricPattern,
        omitGroupByVariableFromMetricName: queryConfig.omitGroupByVariableFromMetricName || [],
        dashboardLabel: queryConfig.dashboardLabel,
        applicationDashboardId: queryConfig.applicationDashboardId,
        metricsSourceId: queryConfig.metricsSourceId,
        panelId: queryConfig.panelId,
        metricName: queryConfig.metricName,  // Explicit metric name (e.g., "CPU Usage")
        result: result.result,
        error: result.error
      };
    });
  }

  /**
   * Store panel documents in database
   */
  private async storePanelDocuments(
    panelDocuments: PanelDocument[],
    _testRunId: string,
    testRun?: unknown
  ): Promise<void> {
    if (panelDocuments.length === 0) {
      this.logger.info('No panel documents to store');
      return;
    }

    await this.withTransaction(async (manager: EntityManager) => {
      this.logger.info(`Storing ${panelDocuments.length} panel documents`);

      for (const doc of panelDocuments) {
        await manager.query(
          `INSERT INTO ds_panels (
            test_run_id,
            application_dashboard_id,
            metrics_source_id,
            dashboard_uid,
            panel_id,
            panel_title,
            dashboard_label,
            panel,
            query_variables,
            datasource_type,
            benchmark_ids,
            requests,
            errors,
            warnings,
            updated_at,
            organization_id,
            team_id,
            created_by,
            updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            doc.test_run_id,
            doc.application_dashboard_id,
            doc.metrics_source_id || null,
            doc.dashboard_uid,
            doc.panel_id,
            doc.panel_title,
            doc.dashboard_label,
            JSON.stringify(doc.panel),
            JSON.stringify(doc.query_variables || {}),
            doc.datasource_type,
            doc.benchmark_ids ? JSON.stringify(doc.benchmark_ids) : null,
            JSON.stringify(doc.requests || []),
            doc.errors ? JSON.stringify(doc.errors) : null,
            doc.warnings ? JSON.stringify(doc.warnings) : null,
            new Date(),
            testRun.organizationId || null,
            testRun.teamId || null,
            'worker-pipeline',
            'worker-pipeline'
          ]
        );
      }

      this.logger.info(`✅ Stored ${panelDocuments.length} panel documents`);
    });
  }

  /**
   * Store metrics directly into TimescaleDB metrics table
   */
  private async storeMetricsDocuments(
    metricsDocuments: PanelMetricsDocument[],
    _testRunId: string,
    testRun?: unknown
  ): Promise<void> {
    if (metricsDocuments.length === 0) {
      this.logger.info('No metrics documents to store');
      return;
    }

    await this.withTransaction(async (manager: EntityManager) => {
      const totalMetrics = metricsDocuments.reduce((sum, doc) => sum + doc.data.length, 0);
      this.logger.info(`💾 Storing ${metricsDocuments.length} metrics documents (${totalMetrics} total data points) to ds_metrics table`);

      // Store individual metrics directly into TimescaleDB ds_metrics table
      let insertCount = 0;
      for (const doc of metricsDocuments) {
        const uniqueMetrics = [...new Set(doc.data.map(m => m.metricName))];
        this.logger.info(`  Panel ${doc.panelId} (${doc.panelTitle}): ${doc.data.length} points, ${uniqueMetrics.length} metrics: ${uniqueMetrics.join(', ')}`);

        for (const metric of doc.data) {
          await manager.query(
            `INSERT INTO ds_metrics (
              test_run_id,
              application_dashboard_id,
              metrics_source_id,
              dashboard_uid,
              panel_id,
              panel_title,
              dashboard_label,
              benchmark_ids,
              errors,
              metric_name,
              time,
              timestep,
              ramp_up,
              value,
              unit,
              organization_id,
              team_id,
              created_by,
              updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, time)
            DO UPDATE SET
              value = EXCLUDED.value,
              timestep = EXCLUDED.timestep,
              ramp_up = EXCLUDED.ramp_up,
              unit = EXCLUDED.unit,
              updated_at = NOW(),
              organization_id = EXCLUDED.organization_id,
              team_id = EXCLUDED.team_id,
              updated_by = EXCLUDED.updated_by,
              metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_metrics.metrics_source_id)`,
            [
              doc.testRunId,
              doc.applicationDashboardId,
              doc.metricsSourceId || null,
              doc.dashboardUid,
              doc.panelId,
              doc.panelTitle,
              doc.dashboardLabel,
              doc.benchmarkIds || [],
              doc.errors ? JSON.stringify(doc.errors) : null,
              metric.metricName,
              metric.time,
              metric.timestep,
              metric.rampUp,
              metric.value,
              metric.unit || null,
              testRun?.organizationId || null,
              testRun?.teamId || null,
              'worker-pipeline',
              'worker-pipeline'
            ]
          );
          insertCount++;
        }
      }

      this.logger.info(`✅ Successfully inserted ${insertCount} metric records into ds_metrics table`);
    });
  }
}