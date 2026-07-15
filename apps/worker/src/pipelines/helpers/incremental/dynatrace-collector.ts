/**
 * Dynatrace Metrics Collector for Incremental Metrics Pipeline
 *
 * Handles Dynatrace metrics collection for specific time ranges.
 * Responsible for:
 * - Loading Dynatrace queries for test runs
 * - Executing queries with time range override
 * - Processing results through data processor and batch processor
 */

import type { Logger } from 'pino';
import { WorkerDatabaseService } from '../../../common/database.service.js';
import { DynatraceAPIClient } from '../../../services/dynatrace/DynatraceAPIClient.js';
import { DynatraceRepository } from '../../../services/dynatrace/DynatraceRepository.js';
import { DataProcessor } from '../../../services/dynatrace/DataProcessor.js';
import { DynatraceQueryConfig } from '../../../types/dynatrace/index.js';
import { resolveDynatraceProxyDispatcher } from '../../../config/proxy-resolver.js';
import type { Dispatcher } from 'undici';
import type { CollectionResult } from './types.js';
import type { BatchProcessor } from './batch-processor.js';
import type { MetricProcessor, TestRunContext } from './metric-processor.js';

/**
 * Test run data with fields needed for Dynatrace collection
 */
interface TestRunData {
  testRunId: string;
  systemUnderTestId: string;
  workload: string;
  testEnvironment: string;
  startTime?: Date;
  endTime?: Date;
  analysisStartOffset?: number;
  analysisEndOffset?: number;
  organizationId?: string | null;
  teamId?: string | null;
}

/**
 * Dynatrace Collector
 *
 * Manages Dynatrace metrics collection for the Incremental Metrics Pipeline.
 */
export class DynatraceCollector {
  private dynatraceRepository: DynatraceRepository;
  private dataProcessor: DataProcessor;

  constructor(
    private logger: Logger,
    private db: WorkerDatabaseService,
    private metricProcessor: MetricProcessor,
    private batchProcessor: BatchProcessor
  ) {
    this.dynatraceRepository = new DynatraceRepository(db);
    this.dataProcessor = new DataProcessor();
  }

  /**
   * Collect Dynatrace metrics for a specific time range
   *
   * @param testRunId - Test run ID
   * @param testRun - Test run context
   * @param dynatraceConfigId - Dynatrace config ID (optional)
   * @param applicationDashboardIds - Application dashboard IDs to collect (optional)
   * @param metricsSourceIds - Metrics source IDs to collect (optional, preferred over applicationDashboardIds)
   * @param fromTime - Start of time range
   * @param toTime - End of time range
   * @returns Collection result with data points and errors
   */
  async collect(
    testRunId: string,
    testRun: TestRunData,
    dynatraceConfigId: string | undefined,
    applicationDashboardIds: string[] | undefined,
    metricsSourceIds: string[] | undefined,
    fromTime: Date,
    toTime: Date
  ): Promise<CollectionResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      this.logger.info(`Collecting Dynatrace metrics for time range`);

      // Load Dynatrace queries — prefer metricsSourceIds over applicationDashboardIds
      const queryConfigs = await this.loadDynatraceQueries(
        testRun,
        dynatraceConfigId,
        applicationDashboardIds,
        metricsSourceIds
      );

      if (queryConfigs.length === 0) {
        this.logger.info(
          `No Dynatrace queries configured for ${testRun.systemUnderTestId}.${testRun.testEnvironment}.${testRun.workload}`
        );
        return {
          success: true,
          dataPoints: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      this.logger.info(`Found ${queryConfigs.length} Dynatrace queries to execute`);

      // Group queries by dynatrace_config_id
      const queriesByConfig = this.groupQueriesByConfig(queryConfigs);

      this.logger.info(`Executing queries across ${queriesByConfig.size} Dynatrace instance(s)`);

      // Execute queries and collect results
      const result = await this.executeQueriesAcrossInstances(
        queriesByConfig,
        testRunId,
        testRun,
        fromTime,
        toTime,
        errors
      );

      return {
        success: errors.length === 0,
        dataPoints: result.totalDataPoints,
        errors,
        duration: Date.now() - startTime,
        maxDataTimestamp: result.maxDataTimestamp,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown Dynatrace collection error';
      this.logger.error(`Dynatrace collection failed: ${errorMessage}`);
      errors.push(errorMessage);

      return {
        success: false,
        dataPoints: 0,
        errors,
        duration,
      };
    }
  }

  /**
   * Load Dynatrace queries from database
   */
  private async loadDynatraceQueries(
    testRun: TestRunData,
    dynatraceConfigId: string | undefined,
    applicationDashboardIds: string[] | undefined,
    metricsSourceIds: string[] | undefined
  ): Promise<Record<string, unknown>[]> {
    let query = `
      SELECT
        dq.id,
        dq.system_under_test_id,
        dq.test_environment,
        dq.workload,
        dq.dashboard_label,
        dq.panel_title,
        dq.query,
        dq.match_metric_pattern,
        dq.omit_group_by_variable_from_metric_name,
        dq.template_variables,
        dq.application_dashboard_id,
        dq.metrics_source_id,
        dq.panel_id,
        dq.metric_unit,
        dq.metric_name,
        dq.dynatrace_config_id
      FROM dynatrace_queries dq
      WHERE dq.system_under_test_id = $1
        AND dq.test_environment = $2
        AND dq.workload = $3
    `;

    const params: unknown[] = [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload];
    let nextParamIndex = 4;

    if (dynatraceConfigId) {
      query += ` AND dq.dynatrace_config_id = $${nextParamIndex}`;
      params.push(dynatraceConfigId);
      nextParamIndex++;
    }

    // Prefer metricsSourceIds over applicationDashboardIds for filtering
    if (metricsSourceIds && metricsSourceIds.length > 0) {
      query += ` AND dq.metrics_source_id = ANY($${nextParamIndex})`;
      params.push(metricsSourceIds);
    } else if (applicationDashboardIds && applicationDashboardIds.length > 0) {
      query += ` AND dq.application_dashboard_id = ANY($${nextParamIndex})`;
      params.push(applicationDashboardIds);
    }

    return this.db.query<Record<string, unknown>>(query, params);
  }

  /**
   * Group queries by Dynatrace config ID
   */
  private groupQueriesByConfig(queryConfigs: Record<string, unknown>[]): Map<string, DynatraceQueryConfig[]> {
    const queriesByConfig = new Map<string, DynatraceQueryConfig[]>();

    for (const config of queryConfigs) {
      const c = config;
      const configId = c.dynatrace_config_id as string;
      if (!queriesByConfig.has(configId)) {
        queriesByConfig.set(configId, []);
      }

      // Process query: replace template variables and clean time range
      let processedQuery = c.query as string;
      if (c.template_variables && Object.keys(c.template_variables as Record<string, unknown>).length > 0) {
        processedQuery = this.metricProcessor.replaceTemplateVariables(processedQuery, c.template_variables as Record<string, unknown>);
      }
      processedQuery = this.metricProcessor.cleanTimeRangeFromQuery(processedQuery);

      // Convert database row to DynatraceQueryConfig
      const queryConfig: DynatraceQueryConfig = {
        tileId: c.id as string,
        tileTitle: c.panel_title as string,
        query: processedQuery,
        visualization: 'timeseries',
        dashboardLabel: c.dashboard_label as string,
        applicationDashboardId: c.application_dashboard_id as string,
        metricsSourceId: c.metrics_source_id as string | undefined,
        querySettings: {},
        matchMetricPattern: c.match_metric_pattern as string | undefined,
        omitGroupByVariableFromMetricName: (c.omit_group_by_variable_from_metric_name as string[] | undefined) || [],
        panelId: c.panel_id as number | null | undefined,
        metricName: c.metric_name as string | undefined,
        dynatraceConfigId: c.dynatrace_config_id as string,
      };

      queriesByConfig.get(configId)!.push(queryConfig);
    }

    return queriesByConfig;
  }

  /**
   * Execute queries across all Dynatrace instances
   */
  private async executeQueriesAcrossInstances(
    queriesByConfig: Map<string, DynatraceQueryConfig[]>,
    testRunId: string,
    testRun: TestRunData,
    fromTime: Date,
    toTime: Date,
    errors: string[]
  ): Promise<{ totalDataPoints: number; maxDataTimestamp?: Date }> {
    let totalDataPoints = 0;
    let maxDataTimestamp: Date | undefined;

    const testRunContext: TestRunContext = {
      startTime: testRun.startTime,
      endTime: testRun.endTime,
      analysisStartOffset: testRun.analysisStartOffset,
      analysisEndOffset: testRun.analysisEndOffset,
      organizationId: testRun.organizationId || null,
      teamId: testRun.teamId || null,
    };

    for (const [configId, queries] of queriesByConfig) {
      try {
        // Load Dynatrace config
        const dynatraceConfig = await this.dynatraceRepository.getDynatraceConfigById(configId);

        if (!dynatraceConfig) {
          const errorMsg = `Dynatrace configuration not found for id: ${configId}`;
          this.logger.error(errorMsg);
          errors.push(errorMsg);
          continue;
        }

        this.logger.info(
          `Executing ${queries.length} queries on ${dynatraceConfig.label} (${dynatraceConfig.host})`
        );

        // Create API client, threading proxy dispatcher when configured
        // Always resolve: returns a dispatcher for a DB ProxyServer row OR env HTTP(S)_PROXY,
        // undefined otherwise. Not gated on useProxy — that flag only covers the DB-row case
        // and would skip the env-proxy fallback in proxy-only deployments.
        const proxyDispatcher = (await resolveDynatraceProxyDispatcher(dynatraceConfig.organizationId)) as Dispatcher | undefined;

        const apiClient = new DynatraceAPIClient({
          host: dynatraceConfig.host,
          apiToken: dynatraceConfig.apiToken,
          platformToken: dynatraceConfig.platformApiToken || '',
          dynatraceType: dynatraceConfig.dynatraceType,
          maxConcurrent: 5,
        }, proxyDispatcher);

        try {
          // Execute queries with time range override
          const queryResults = await apiClient.executeBatchQueries(queries, fromTime, toTime);

          // Process results
          const { metricsDocuments } = await this.dataProcessor.processDynatraceResults(
            queryResults.map((result, index) => ({
              tileId: result.tileId,
              tileTitle: result.tileTitle,
              visualization: queries[index].visualization,
              query: queries[index].query,
              matchMetricPattern: queries[index].matchMetricPattern,
              omitGroupByVariableFromMetricName: queries[index].omitGroupByVariableFromMetricName || [],
              dashboardLabel: queries[index].dashboardLabel,
              applicationDashboardId: queries[index].applicationDashboardId,
              metricsSourceId: queries[index].metricsSourceId,
              panelId: queries[index].panelId,
              metricName: queries[index].metricName,
              result: result.result,
              error: result.error,
            })),
            testRunId,
            toTime,
            testRun
          );

          // Process metrics documents using batch processor
          const batchResult = await this.batchProcessor.processDynatraceDocuments(
            metricsDocuments,
            testRunContext
          );

          // Accumulate results
          totalDataPoints += batchResult.totalRecords;
          errors.push(...batchResult.errors);

          // Track max timestamp
          if (batchResult.maxDataTimestamp) {
            if (!maxDataTimestamp || batchResult.maxDataTimestamp > maxDataTimestamp) {
              maxDataTimestamp = batchResult.maxDataTimestamp;
            }
          }

          if (batchResult.totalRecords > 0) {
            this.logger.info(
              `Saved ${batchResult.totalRecords} Dynatrace metric records from ${dynatraceConfig.label}`
            );
          }
        } finally {
          await apiClient.close();
        }
      } catch (error) {
        const errorMsg = error instanceof Error
          ? error.message
          : `Unknown error for Dynatrace config ${configId}`;
        this.logger.error(`Failed to collect from Dynatrace config ${configId}: ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    if (maxDataTimestamp) {
      this.logger.info(
        `Dynatrace collection complete: ${totalDataPoints} data points, maxDataTimestamp: ${maxDataTimestamp.toISOString()}`
      );
    }

    return { totalDataPoints, maxDataTimestamp };
  }
}
