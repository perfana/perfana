/**
 * Grafana Metrics Collector for Incremental Metrics Pipeline
 *
 * Handles Grafana metrics collection for specific time ranges.
 * Responsible for:
 * - Initializing Grafana client
 * - Loading panels for test runs
 * - Querying Grafana for panel data
 * - Processing results through batch processor
 */

import type { Logger } from 'pino';
import { GrafanaClient } from '@perfana/shared/services/grafana';
import { getGrafanaConfig, getGrafanaInstanceMeta } from '../../../config/grafana-config-cache.js';
import { resolveProxyDispatcher } from '../../../config/proxy-resolver.js';
import { WorkerDatabaseService } from '../../../common/database.service.js';
import { PanelsPipeline } from '../../PanelsPipeline.js';
import type { PanelDocument } from '../../../types/pipeline.js';
import type { CollectionResult } from './types.js';
import type { BatchProcessor } from './batch-processor.js';
import type { TestRunContext } from './metric-processor.js';

/**
 * Test run data with fields needed for Grafana adapter
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
  createdAt?: Date;
  updatedAt?: Date;
  organizationId?: string | null;
  teamId?: string | null;
}

/**
 * Grafana Collector
 *
 * Manages Grafana metrics collection for the Incremental Metrics Pipeline.
 */
export class GrafanaCollector {
  private grafanaClient: GrafanaClient | null = null;

  constructor(
    private logger: Logger,
    private db: WorkerDatabaseService,
    private batchProcessor: BatchProcessor
  ) {}

  /**
   * Initialize Grafana client with cached configuration
   */
  private async initializeGrafanaClient(): Promise<void> {
    if (this.grafanaClient) {
      return;
    }

    const grafanaConfig = await getGrafanaConfig();
    const meta = getGrafanaInstanceMeta();
    if (meta?.useProxy) {
      const dispatcher = await resolveProxyDispatcher(meta.organizationId);
      if (dispatcher) {
        grafanaConfig.dispatcher = dispatcher;
        this.logger.info(`Grafana client will use org proxy (org: ${meta.organizationId})`);
      }
    }
    this.grafanaClient = new GrafanaClient(grafanaConfig, this.logger);
    this.logger.info(`Initialized Grafana client with URL: ${grafanaConfig.url}`);
  }

  /**
   * Collect Grafana metrics for a specific time range
   *
   * @param testRunId - Test run ID
   * @param testRun - Test run context
   * @param grafanaInstanceId - Grafana instance ID (optional)
   * @param applicationDashboardIds - Application dashboard IDs to collect (optional)
   * @param metricsSourceIds - Metrics source IDs to collect (optional, preferred over applicationDashboardIds)
   * @param fromTime - Start of time range
   * @param toTime - End of time range
   * @returns Collection result with data points and errors
   */
  async collect(
    testRunId: string,
    testRun: TestRunData,
    grafanaInstanceId: string | undefined,
    applicationDashboardIds: string[] | undefined,
    metricsSourceIds: string[] | undefined,
    fromTime: Date,
    toTime: Date
  ): Promise<CollectionResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      this.logger.info(`Collecting Grafana metrics for time range`);

      // Initialize Grafana client
      await this.initializeGrafanaClient();

      // Load panels — prefer metricsSourceIds over applicationDashboardIds
      const panels = await this.loadPanels(testRunId, applicationDashboardIds, metricsSourceIds);

      if (panels.length === 0) {
        return {
          success: true,
          dataPoints: 0,
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      this.logger.info(`Found ${panels.length} panels to query`);

      // Create test run adapter for Grafana client (with time range override)
      const testRunAdapter = {
        test_run_id: testRun.testRunId,
        system_under_test_id: testRun.systemUnderTestId,
        workload: testRun.workload,
        test_environment: testRun.testEnvironment,
        start_time: fromTime, // Override with incremental time range
        end_time: toTime, // Override with incremental time range
        ramp_up: testRun.analysisStartOffset || 0,
        created_at: testRun.createdAt,
        updated_at: testRun.updatedAt,
      };

      // Query Grafana for panel data
      if (!this.grafanaClient) {
        throw new Error('Grafana client not initialized');
      }

      const metricsDocuments = await this.grafanaClient.queryPanelData(panels, testRunAdapter, {
        from: fromTime,
        to: toTime,
      });

      // Process metrics documents using batch processor
      const testRunContext: TestRunContext = {
        startTime: testRun.startTime,
        endTime: testRun.endTime,
        analysisStartOffset: testRun.analysisStartOffset,
        analysisEndOffset: testRun.analysisEndOffset,
        organizationId: testRun.organizationId || null,
        teamId: testRun.teamId || null,
      };

      const batchResult = await this.batchProcessor.processGrafanaDocuments(
        metricsDocuments,
        testRunContext
      );

      // Merge batch errors
      errors.push(...batchResult.errors);

      if (batchResult.totalRecords > 0) {
        this.logger.info(`Saved ${batchResult.totalRecords} Grafana metric records`);
      }

      return {
        success: true,
        dataPoints: batchResult.totalRecords,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown Grafana collection error';
      this.logger.error(`Grafana collection failed: ${errorMessage}`);
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
   * Load panels for a test run, populating if needed
   */
  private async loadPanels(
    testRunId: string,
    applicationDashboardIds: string[] | undefined,
    metricsSourceIds: string[] | undefined
  ): Promise<PanelDocument[]> {
    let query = `
      SELECT
        test_run_id,
        application_dashboard_id,
        metrics_source_id,
        dashboard_uid,
        panel_id,
        panel_title,
        dashboard_label,
        benchmark_ids,
        panel,
        requests,
        errors
      FROM ds_panels
      WHERE test_run_id = $1
    `;

    const params: unknown[] = [testRunId];

    // Prefer metricsSourceIds over applicationDashboardIds for filtering
    if (metricsSourceIds && metricsSourceIds.length > 0) {
      query += ` AND metrics_source_id = ANY($2)`;
      params.push(metricsSourceIds);
    } else if (applicationDashboardIds && applicationDashboardIds.length > 0) {
      query += ` AND application_dashboard_id = ANY($2)`;
      params.push(applicationDashboardIds);
    }

    let panels = await this.db.query<PanelDocument>(query, params);

    // If no panels exist yet, run PanelsPipeline to populate them first
    if (panels.length === 0) {
      this.logger.info(`No panels found for test run ${testRunId}, populating panels first...`);

      try {
        const panelsPipeline = new PanelsPipeline(this.logger);
        const panelsResult = await panelsPipeline.execute({ testRunId });

        if (!panelsResult.success) {
          this.logger.warn(`PanelsPipeline failed: ${panelsResult.error}`);
          return [];
        }

        // Re-query panels after population
        panels = await this.db.query<PanelDocument>(query, params);
        this.logger.info(`PanelsPipeline completed, found ${panels.length} panels`);
      } catch (panelError) {
        const errorMessage = panelError instanceof Error ? panelError.message : String(panelError);
        this.logger.warn(`Failed to populate panels: ${errorMessage}`);
        return [];
      }
    }

    if (panels.length === 0) {
      this.logger.warn(`Still no panels found for test run ${testRunId} after population attempt`);
    }

    return panels;
  }
}
