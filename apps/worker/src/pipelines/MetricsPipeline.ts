import { EntityManager } from 'typeorm';
import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult, PanelDocument, PanelMetricsDocument } from '../types/pipeline.js';
import { GrafanaClient } from '@perfana/shared/services/grafana';
import { getLogger as _getLogger } from '../lib/utils/logger.js';
import { getGrafanaConfig, getGrafanaInstanceId } from '../config/grafana-config-cache.js';

interface MetricsInput {
  testRunId: string;
  benchmarksOnly?: boolean;
  panelDocuments?: PanelDocument[];
}

/**
 * Metrics Pipeline - Core component for Grafana data extraction
 *
 * Replicates the Python implementation from:
 * - /Users/daniel/workspace/perfana-ds/src/perfana_ds/pipelines/metrics/pipeline.py
 * - Specification: METRICS_PIPELINE.md (Lines 108-122, 695-767)
 *
 * Key responsibilities:
 * 1. Load panel documents from database
 * 2. Separate benchmark vs non-benchmark panels
 * 3. Query Grafana API with batched requests
 * 4. Transform response data to time-series format
 * 5. Store flattened metrics in PostgreSQL/TimescaleDB
 *
 * Connection optimization:
 * - Uses cached Grafana config (no DB query per job)
 * - Acquires DB connections only when needed
 * - Releases connections immediately after use
 */
export class MetricsPipeline extends BasePipelineTypeORM {
  private grafanaClient: GrafanaClient | null = null;

  private initializeGrafanaClient(): void {
    if (this.grafanaClient) {return;}

    // Use cached Grafana config - no database connection needed
    const grafanaConfig = getGrafanaConfig();
    this.grafanaClient = new GrafanaClient(grafanaConfig, this.logger);
    this.logger.info(`🔗 Initialized Grafana client with URL: ${grafanaConfig.url}`);
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      // Validate and parse input
      const validatedInput = this.validateAndParseInput(input);
      const { testRunId, benchmarksOnly = false, panelDocuments } = validatedInput;

      this.logger.info(`🔷 Starting metrics collection for test run: ${testRunId}`);

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_metrics']);

      // Initialize Grafana client with cached configuration (no DB query)
      this.initializeGrafanaClient();

      // Load test run and panels using TypeORM
      const testRun = await this.db.getTestRunByTestRunId(testRunId);

      if (!testRun) {
        throw new Error(`Test run not found: ${testRunId}`);
      }

      // Load panels (if not provided)
      let panels: PanelDocument[];
      if (!panelDocuments) {
        const loadedPanels = await this.db.getDsPanelsByTestRun(testRunId);

        // Transform to match expected format
        panels = loadedPanels.map(panel => ({
          test_run_id: panel.test_run_id,
          application_dashboard_id: panel.application_dashboard_id,
          dashboard_uid: panel.dashboard_uid || '', // Provide default empty string
          panel_id: panel.panel_id || 0, // Provide default 0
          panel_title: panel.panel_title || '', // Provide default empty string
          dashboard_label: panel.dashboard_label || '', // Provide default empty string
          benchmark_ids: panel.benchmark_ids || null,
          panel: panel.panel,
          errors: panel.errors as any || null, // Type assertion needed for compatibility
          requests: typeof panel.requests === 'string' ? JSON.parse(panel.requests || '[]') : (panel.requests || []),
          updated_at: panel.updated_at
        }));
      } else {
        panels = panelDocuments;
      }

      // Create adapter for testRun (convert camelCase to snake_case for compatibility)
      const testRunAdapter = {
        test_run_id: testRun.testRunId,
        system_under_test_id: testRun.systemUnderTestId,
        workload: testRun.workload,
        test_environment: testRun.testEnvironment,
        start_time: testRun.startTime,
        end_time: testRun.endTime,
        ramp_up: testRun.rampUp || 0,
        created_at: testRun.createdAt,
        updated_at: testRun.updatedAt,
        organization_id: testRun.organizationId || null,
        team_id: testRun.teamId || null,
      };

      if (panels.length === 0) {
        this.logger.warn(`⚠️ No panel documents found for test run ${testRunId}`);
        return this.createSuccessResult({
          testRunId,
          metricsCollected: 0,
          panels: 0
        }, Date.now() - startTime);
      }

      this.logger.info(`📊 Processing ${panels.length} panels (benchmarksOnly: ${benchmarksOnly})`);

      // Filter panels based on benchmarksOnly flag
      const panelsToProcess = benchmarksOnly
        ? panels.filter(panel => panel.benchmark_ids !== null && panel.benchmark_ids !== undefined)
        : panels;

      if (panelsToProcess.length === 0) {
        this.logger.warn(`⚠️ No panels to process after filtering (benchmarksOnly: ${benchmarksOnly})`);
        return this.createSuccessResult({
          testRunId,
          metricsCollected: 0,
          dataPoints: 0,
          panels: panels.length,
          processedPanels: 0
        }, Date.now() - startTime);
      }

      this.logger.info(`📊 Processing ${panelsToProcess.length} panels...`);

      // Process all panels at once and get flattened records directly
      const flattenedRecords = await this.getPanelMetricsAsRecords(testRunAdapter, panelsToProcess);

      if (flattenedRecords.length > 0) {
        await this.saveRecordsToDatabase(flattenedRecords);
        this.logger.info(`💾 Saved ${flattenedRecords.length} metric records to PostgreSQL`);
      }

      // Track collection status for gap detection by refresh-missing-data
      try {
        const grafanaInstanceId = getGrafanaInstanceId();
        if (testRun.startTime && testRun.endTime) {
          await this.db.updateCollectedRanges(
            testRunId,
            'grafana',
            grafanaInstanceId,
            { from: testRun.startTime, to: testRun.endTime }
          );
          await this.db.markCollectionComplete(testRunId, 'grafana', grafanaInstanceId);
          this.logger.info(`📋 Collection status tracked: grafana/${grafanaInstanceId ?? 'null'} marked complete`);
        }
      } catch (statusError) {
        // Non-fatal: collection status tracking failure shouldn't fail the pipeline
        this.logger.warn(`⚠️ Failed to track collection status: ${statusError}`);
      }

      const duration = Date.now() - startTime;
      const totalDataPoints = flattenedRecords.length;

      this.logger.info(`✅ Metrics collection completed: ${totalDataPoints} metric records in ${(duration / 1000).toFixed(2)}s`);

      return this.createSuccessResult({
        testRunId,
        metricsCollected: totalDataPoints,
        dataPoints: totalDataPoints,
        panels: panels.length,
        processedPanels: panelsToProcess.length,
        benchmarksOnly
      }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;

      this.logError(error as Error, {
        testRunId: (input as any)?.testRunId,
        duration
      });

      this.logger.error(`❌ Metrics collection failed after ${(duration / 1000).toFixed(2)}s: ${error}`);

      return this.createErrorResult(
        error as Error,
        'METRICS_COLLECTION_ERROR',
        { testRunId: (input as any)?.testRunId },
        duration
      );
    }
  }

  /**
   * Validate and parse input parameters
   */
  private validateAndParseInput(input: unknown): MetricsInput {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: must be an object');
    }

    const { testRunId, benchmarksOnly, panelDocuments } = input as any;

    if (!testRunId || typeof testRunId !== 'string') {
      throw new Error('Invalid input: testRunId is required and must be a string');
    }

    return {
      testRunId,
      benchmarksOnly: Boolean(benchmarksOnly),
      panelDocuments
    };
  }


  /**
   * Get panel metrics as flattened records directly
   * Simplified version that bypasses intermediate PanelMetricsDocument step
   */
  private async getPanelMetricsAsRecords(testRun: any, panels: PanelDocument[]): Promise<any[]> {
    // Separate panels with/without errors for different processing (Python pattern)
    const panelsWithoutErrors = panels.filter(panel =>
      panel.errors === null || panel.errors === undefined
    );
    const panelsWithErrors = panels.filter(panel =>
      panel.errors !== null && panel.errors !== undefined
    );

    const allRecords: any[] = [];

    // Process panels without errors - query Grafana and transform to records
    if (panelsWithoutErrors.length > 0) {
      this.logger.info(`🔍 Querying Grafana for ${panelsWithoutErrors.length} panels without errors`);

      try {
        if (!this.grafanaClient) {
          throw new Error('Grafana client not initialized');
        }
        const grafanaResults = await this.grafanaClient.queryPanelData(panelsWithoutErrors, testRun);

        // Flatten the results directly to records
        for (const metricsDocument of grafanaResults) {
          // Skip storing data if query returned errors or empty results
          if (metricsDocument.errors && metricsDocument.errors.length > 0) {
            const errorMessages = metricsDocument.errors
              .map((e: { message?: string }) => e.message || JSON.stringify(e))
              .join('; ');
            this.logger.warn(`⚠️ Skipping storage for panel ${metricsDocument.panel_id} (${metricsDocument.panel_title}): ${errorMessages}`);
            continue;
          }

          // Skip storing data if query returned empty results
          if (!metricsDocument.data || metricsDocument.data.length === 0) {
            this.logger.warn(`⚠️ Skipping storage for panel ${metricsDocument.panel_id} - query returned empty results`, {
              panel_id: metricsDocument.panel_id,
              panel_title: metricsDocument.panel_title
            });
            continue;
          }

          const flattenedRecords = this.flattenSingleDocument(metricsDocument, testRun);
          allRecords.push(...flattenedRecords);
        }
      } catch (error) {
        this.logger.error('❌ Grafana query failed:', error);
        // Just log the error, don't store error records
        for (const panel of panelsWithoutErrors) {
          this.logger.error(`❌ Failed to query panel ${panel.panel_id} (${panel.panel_title}):`, error);
        }
      }
    }

    // Process panels with errors - just log them, don't store
    if (panelsWithErrors.length > 0) {
      this.logger.warn(`⚠️ Skipping storage for ${panelsWithErrors.length} panels with existing errors`);
      for (const panel of panelsWithErrors) {
        const errorMessages = (panel.errors || [])
          .map((e: { message?: string }) => e.message || JSON.stringify(e))
          .join('; ');
        this.logger.warn(`⚠️ Skipping panel ${panel.panel_id} (${panel.panel_title}): ${errorMessages}`);
      }
    }

    return allRecords;
  }

  /**
   * Flatten a single PanelMetricsDocument to individual PostgreSQL records
   * Helper method for the new direct flattening approach
   * @param testRun - Test run information including start_time and ramp_up duration
   */
  private flattenSingleDocument(document: PanelMetricsDocument, testRun: any): any[] {
    const baseData = {
      test_run_id: document.test_run_id,
      application_dashboard_id: document.application_dashboard_id,
      metrics_source_id: document.metrics_source_id || null,
      dashboard_uid: document.dashboard_uid,
      panel_id: document.panel_id,
      panel_title: document.panel_title,
      dashboard_label: document.dashboard_label,
      benchmark_ids: document.benchmark_ids,
      errors: document.errors ? JSON.stringify(document.errors) : null,
      updated_at: document.updated_at,
      organization_id: testRun.organization_id || null,
      team_id: testRun.team_id || null,
      created_by: 'worker-pipeline',
      updated_by: 'worker-pipeline',
    };

    const flattened: any[] = [];
    const dataRecords = document.data || [];

    if (dataRecords.length > 0) {
      // Normal case: document has data records
      for (const record of dataRecords) {
        // Calculate ramp_up flag based on test run timing
        let isRampUp = false;
        if (testRun.start_time && testRun.ramp_up !== undefined) {
          const recordTime = new Date(record.time);
          const elapsedSeconds = (recordTime.getTime() - testRun.start_time.getTime()) / 1000;
          isRampUp = elapsedSeconds < testRun.ramp_up;
        }

        flattened.push({
          ...baseData,
          metric_name: record.metric_name,
          time: record.time,
          timestep: record.timestep,
          ramp_up: isRampUp,
          value: record.value,
          unit: record.unit || null,
          created_at: new Date()
        });
      }
    } else {
      // Error case: document has no data but may have errors - create one error record
      flattened.push({
        ...baseData,
        metric_name: 'error',
        time: new Date(),
        timestep: null,
        ramp_up: false,
        value: 0,
        unit: null,
        created_at: new Date()
      });
    }

    return flattened;
  }

  /**
   * Create error record for failed panels
   */
  private createErrorRecord(panel: PanelDocument, error: Error): any {
    return {
      test_run_id: panel.test_run_id,
      application_dashboard_id: panel.application_dashboard_id,
      metrics_source_id: panel.metrics_source_id || null,
      dashboard_uid: panel.dashboard_uid,
      panel_id: panel.panel_id,
      panel_title: panel.panel_title,
      dashboard_label: panel.dashboard_label,
      benchmark_ids: panel.benchmark_ids,
      errors: JSON.stringify([{
        target_index: 0,
        message: `Grafana query failed: ${error.message}`,
        type: 'grafana_error',
        status_code: undefined
      }]),
      metric_name: 'error',
      time: new Date(),
      timestep: null,
      ramp_up: false,
      value: 0,
      unit: null,
      updated_at: new Date(),
      created_at: new Date()
    };
  }

  /**
   * Create empty record for panels with existing errors
   */
  private createEmptyRecord(panel: PanelDocument): any {
    return {
      test_run_id: panel.test_run_id,
      application_dashboard_id: panel.application_dashboard_id,
      metrics_source_id: panel.metrics_source_id || null,
      dashboard_uid: panel.dashboard_uid,
      panel_id: panel.panel_id,
      panel_title: panel.panel_title,
      dashboard_label: panel.dashboard_label,
      benchmark_ids: panel.benchmark_ids,
      errors: panel.errors ? JSON.stringify(panel.errors) : null,
      metric_name: 'empty',
      time: new Date(),
      timestep: null,
      ramp_up: false,
      value: 0,
      unit: null,
      updated_at: new Date(),
      created_at: new Date()
    };
  }

  /**
   * Save flattened records directly to PostgreSQL with batch processing
   * Simplified version that works with pre-flattened records
   */
  private async saveRecordsToDatabase(records: any[]): Promise<void> {
    if (records.length === 0) {return;}

    return this.withTransaction(async (manager: EntityManager) => {
      if (records.length === 0) {
        this.logger.info('📊 No data records to insert');
        return;
      }

      // Batch insert with PostgreSQL parameter limit compliance
      // Python uses 200-record batches: 200 × 16 fields = 3,200 parameters
      await this.batchInsertRecords(manager, records);
    });
  }


  /**
   * Batch insert records to PostgreSQL
   * Conservative batch size for parameter limit compliance
   */
  private async batchInsertRecords(manager: EntityManager, records: any[]): Promise<void> {
    const batchSize = 200; // Conservative batch size from Python implementation

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await this.insertBatch(manager, batch);

      if (records.length > batchSize) {
        const _batchNum = Math.floor(i / batchSize) + 1;
        const _totalBatches = Math.ceil(records.length / batchSize);
      }
    }
  }

  /**
   * Insert a single batch of records using UPSERT pattern (matches Python TimescaleDB implementation)
   */
  private async insertBatch(manager: EntityManager, batch: any[]): Promise<void> {
    if (batch.length === 0) {return;}


    const columns = [
      'test_run_id', 'application_dashboard_id', 'metrics_source_id', 'dashboard_uid', 'panel_id',
      'panel_title', 'dashboard_label', 'benchmark_ids', 'errors',
      'metric_name', 'time', 'timestep', 'ramp_up', 'value', 'unit', 'updated_at', 'created_at',
      'organization_id', 'team_id', 'created_by', 'updated_by'
    ];

    // Generate VALUES clauses for bulk INSERT with UPSERT
    const values = batch.map((_, index) =>
      `(${columns.map((_, colIndex) => `$${index * columns.length + colIndex + 1}`).join(', ')})`
    ).join(', ');

    // PostgreSQL UPSERT using ON CONFLICT with unique constraint on key fields + time + metric_name
    // This matches Python TimescaleDB behavior where each metric record at a specific time is unique
    const sql = `
      INSERT INTO ds_metrics (${columns.join(', ')})
      VALUES ${values}
      ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, time)
      DO UPDATE SET
        panel_title = EXCLUDED.panel_title,
        dashboard_label = EXCLUDED.dashboard_label,
        dashboard_uid = EXCLUDED.dashboard_uid,
        metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_metrics.metrics_source_id),
        benchmark_ids = EXCLUDED.benchmark_ids,
        errors = EXCLUDED.errors,
        timestep = EXCLUDED.timestep,
        ramp_up = EXCLUDED.ramp_up,
        value = EXCLUDED.value,
        unit = EXCLUDED.unit,
        updated_at = EXCLUDED.updated_at,
        organization_id = EXCLUDED.organization_id,
        team_id = EXCLUDED.team_id,
        updated_by = EXCLUDED.updated_by
    `;

    // Column length limits from the database schema
    const varcharLimits: Record<string, number> = {
      metric_name: 255,
      dashboard_uid: 255,
      dashboard_label: 255,
      panel_title: 500,
      unit: 50,
    };

    // Flatten parameters for prepared statement, truncating strings to column limits
    const params = batch.flatMap(record =>
      columns.map(col => {
        const val = record[col];
        const limit = varcharLimits[col];
        return (limit && typeof val === 'string') ? val.substring(0, limit) : val;
      })
    );

    await manager.query(sql, params);
  }

}