import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { getConfig } from '../config/environment.js';
import { DynatraceRepository } from '../services/dynatrace/DynatraceRepository.js';
import { QueryConstructor } from '../services/dynatrace/QueryConstructor.js';
import { DynatraceAPIClient } from '../services/dynatrace/DynatraceAPIClient.js';
import { DataProcessor } from '../services/dynatrace/DataProcessor.js';
import { MetricProcessor, type FlattenedMetricRecord } from './helpers/incremental/metric-processor.js';
import { resolveDynatraceAxiosProxy } from '../config/proxy-resolver.js';
import {
  DynatraceQueryConfig,
  DynatraceQueryResult,
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

interface DynatraceInput {
  testRunIds: string[];
}

export class DynatracePipeline extends BasePipelineTypeORM {
  private repository: DynatraceRepository;
  private queryConstructor: QueryConstructor;
  private dataProcessor: DataProcessor;
  private config = getConfig();

  constructor(logger: import('pino').Logger) {
    super(logger);
    // DynatraceRepository migrated to use TypeORM WorkerDatabaseService
    this.repository = new DynatraceRepository(this.db);
    this.queryConstructor = new QueryConstructor(this.repository);
    this.dataProcessor = new DataProcessor();
  }

  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as { testRunIds?: unknown[] };
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
    // Only configs whose batch actually ran may be marked complete. The loop below has
    // three `continue` branches (config row gone, missing api token, SaaS without a
    // platform token) that execute ZERO queries — marking those complete tells the
    // orchestrator the run is fully collected and it skips every collection stage next
    // time, so a revoked token would silently become permanent.
    const executedConfigIds = new Set<string>();

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

      // Mirror the API's DynatraceService: only pass an explicit proxy when
      // use_proxy is set (+ a DB ProxyServer row); otherwise axios reads
      // HTTP(S)_PROXY/NO_PROXY from the env and honors NO_PROXY on its own.
      const proxyOpts = await resolveDynatraceAxiosProxy(dynatraceConfig.organizationId, dynatraceConfig.useProxy);

      const apiClient = new DynatraceAPIClient({
        host: dynatraceConfig.host,
        apiToken,
        platformToken: platformToken || '', // Empty string for managed instances
        dynatraceType: dynatraceConfig.dynatraceType,
        maxConcurrent: 5  // Execute queries with controlled concurrency
      }, proxyOpts);

      try {
        const configQueryResults = await this.executeQueries(
          apiClient,
          configQueries,
          testRun.startTime || new Date(),
          testRun.endTime || new Date()
        );

        allQueryResults.push(...configQueryResults);
        // A query that failed comes back as { result: null, error } — executeBatchQueries
        // catches per query and never throws — so "everything 401'd" is indistinguishable
        // from "everything succeeded with no data" downstream. Require every query in the
        // batch to have succeeded before calling this config collected.
        if (configQueryResults.every(r => !r.error)) {
          executedConfigIds.add(dynatraceConfigId);
        } else {
          this.logger.warn(
            `Dynatrace config ${dynatraceConfigId}: ` +
            `${configQueryResults.filter(r => r.error).length}/${configQueryResults.length} ` +
            `queries failed — not marking collection complete so it is retried`
          );
        }
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

    // Skip storage if no data was returned. Deliberately does NOT mark the source
    // complete: `metricsDocuments.length === 0` is the SAME signal for "ran fine, no data"
    // and "every query failed" (see the error check above), and `is_complete` is sticky —
    // it makes PipelineOrchestrator skip every collection stage on the next analyze, so an
    // expired token would never be re-collected after it was fixed. A config that is
    // genuinely switched off should register no source at all; that is handled by
    // services/collectable-sources.ts, not here.
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
    await this.trackCollectionStatus(testRunId, testRun, executedConfigIds);

    return {
      panelCount: panelDocuments.length,
      metricsCount: metricsDocuments.length,
      queryCount: queries.length
    };
  }

  /**
   * Record that each Dynatrace config has been fully processed for this run.
   *
   * Writes one full-span range and marks the source complete. That range is what makes
   * coverage read 100%: the incremental ticks contribute nothing, because a tick with no
   * data deliberately records a zero-width range so its window is retried.
   *
   * Never throws: a failure to write bookkeeping must not fail a collection that worked.
   */
  private async trackCollectionStatus(
    testRunId: string,
    testRun: { startTime?: Date | null; endTime?: Date | null },
    dynatraceConfigIds: Iterable<string>
  ): Promise<void> {
    if (!testRun.startTime || !testRun.endTime) {
      return;
    }

    for (const dynatraceConfigId of dynatraceConfigIds) {
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
   * Store metrics into ds_metrics through the shared batched upsert.
   *
   * The documents already carry timestep and ramp_up from DataProcessor, so this only
   * reshapes them; it deliberately does not go through flattenDynatraceMetricsDocument,
   * which recomputes both from the test run.
   */
  private async storeMetricsDocuments(
    metricsDocuments: PanelMetricsDocument[],
    _testRunId: string,
    testRun?: { organizationId?: string; teamId?: string }
  ): Promise<void> {
    if (metricsDocuments.length === 0) {
      this.logger.info('No metrics documents to store');
      return;
    }

    const records: FlattenedMetricRecord[] = [];
    for (const doc of metricsDocuments) {
      const uniqueMetrics = [...new Set(doc.data.map(m => m.metricName))];
      this.logger.info(`  Panel ${doc.panelId} (${doc.panelTitle}): ${doc.data.length} points, ${uniqueMetrics.length} metrics: ${uniqueMetrics.join(', ')}`);
      for (const metric of doc.data) {
        records.push({
          test_run_id: doc.testRunId,
          application_dashboard_id: doc.applicationDashboardId,
          metrics_source_id: doc.metricsSourceId || null,
          dashboard_uid: doc.dashboardUid,
          panel_id: doc.panelId,
          panel_title: doc.panelTitle,
          dashboard_label: doc.dashboardLabel,
          benchmark_ids: doc.benchmarkIds || [],
          errors: doc.errors ? JSON.stringify(doc.errors) : null,
          metric_name: metric.metricName,
          time: metric.time,
          timestep: metric.timestep,
          ramp_up: metric.rampUp,
          value: metric.value,
          unit: metric.unit || null,
          organization_id: testRun?.organizationId ?? null,
          team_id: testRun?.teamId ?? null,
          created_by: 'worker-pipeline',
          updated_by: 'worker-pipeline',
        });
      }
    }

    this.logger.info(`💾 Storing ${metricsDocuments.length} metrics documents (${records.length} total data points) to ds_metrics table`);
    await new MetricProcessor(this.logger, this.db).upsertMetricsToDatabase(records);
    this.logger.info(`✅ Successfully upserted ${records.length} metric records into ds_metrics table`);
  }
}
