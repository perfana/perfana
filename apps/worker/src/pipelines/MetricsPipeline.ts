import { EntityManager } from 'typeorm';
import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult, PanelDocument, PanelMetricsDocument } from '../types/pipeline.js';
import { getGrafanaInstanceId, tryGetGrafanaConfig } from '../config/grafana-config-cache.js';
import { groupPanelsByGrafanaInstance } from '../config/grafana-client-factory.js';

/**
 * Number of records per INSERT batch.
 * Chosen to stay within PostgreSQL's parameter limit: 200 rows x 21 columns = 4,200 params
 * (well under the 65535 parameter ceiling). Matches the Python implementation batch size.
 */
const DB_INSERT_BATCH_SIZE = 200;

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
  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      // Validate and parse input
      const validatedInput = this.validateAndParseInput(input);
      const { testRunId, benchmarksOnly = false, panelDocuments } = validatedInput;

      this.logger.info(`🔷 Starting metrics collection for test run: ${testRunId}`);

      // Soft-skip when no Grafana instance is configured. Grafana is documented
      // as an optional metric source — without one there is nothing to collect,
      // but downstream stages must still run. See issue #282.
      const grafanaConfig = await tryGetGrafanaConfig();
      if (!grafanaConfig) {
        this.logger.info('No Grafana instance configured — skipping metrics-collection');
        return this.createSuccessResult({
          testRunId,
          skipped: 'no-grafana-configured',
        }, Date.now() - startTime);
      }

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_metrics']);

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
          metrics_source_id: panel.metrics_source_id,
          dashboard_uid: panel.dashboard_uid || '', // Provide default empty string
          panel_id: panel.panel_id || 0, // Provide default 0
          panel_title: panel.panel_title || '', // Provide default empty string
          dashboard_label: panel.dashboard_label || '', // Provide default empty string
          benchmark_ids: panel.benchmark_ids || null,
          panel: panel.panel,
          errors: panel.errors as unknown as PanelDocument['errors'],
          requests: typeof panel.requests === 'string' ? JSON.parse(panel.requests || '[]') : (panel.requests || []),
          updated_at: panel.updated_at
        }));
      } else {
        panels = panelDocuments;
      }

      // Create adapter for testRun (convert camelCase to snake_case for compatibility)
      const rampDownSeconds = testRun.analysisEndOffset ?? 0;
      const effectiveEndTime = testRun.endTime && rampDownSeconds > 0
        ? new Date(testRun.endTime.getTime() - rampDownSeconds * 1000)
        : testRun.endTime;

      const testRunAdapter = {
        test_run_id: testRun.testRunId,
        system_under_test_id: testRun.systemUnderTestId,
        workload: testRun.workload,
        test_environment: testRun.testEnvironment,
        start_time: testRun.startTime,
        end_time: effectiveEndTime,
        ramp_up: testRun.analysisStartOffset || 0,
        ramp_down: rampDownSeconds,
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

      const testRunId = (input && typeof input === 'object' && 'testRunId' in input)
        ? (input as { testRunId?: unknown }).testRunId
        : undefined;

      this.logError(error as Error, {
        testRunId,
        duration
      });

      this.logger.error(`❌ Metrics collection failed after ${(duration / 1000).toFixed(2)}s: ${error}`);

      return this.createErrorResult(
        error as Error,
        'METRICS_COLLECTION_ERROR',
        { testRunId },
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

    const { testRunId, benchmarksOnly, panelDocuments } = input as Record<string, unknown>;

    if (!testRunId || typeof testRunId !== 'string') {
      throw new Error('Invalid input: testRunId is required and must be a string');
    }

    return {
      testRunId: testRunId as string,
      benchmarksOnly: Boolean(benchmarksOnly),
      panelDocuments: panelDocuments as PanelDocument[] | undefined
    };
  }


  /**
   * Get panel metrics as flattened records directly
   * Simplified version that bypasses intermediate PanelMetricsDocument step
   */
  private async getPanelMetricsAsRecords(testRun: { start_time?: Date; end_time?: Date; ramp_up?: number; ramp_down?: number; organization_id?: string | null; team_id?: string | null }, panels: PanelDocument[]): Promise<unknown[]> {
    // Separate panels with/without errors for different processing (Python pattern)
    const panelsWithoutErrors = panels.filter(panel =>
      panel.errors === null || panel.errors === undefined
    );
    const panelsWithErrors = panels.filter(panel =>
      panel.errors !== null && panel.errors !== undefined
    );

    const allRecords: unknown[] = [];

    // Process panels without errors - query Grafana and transform to records.
    // Panels can span multiple Grafana instances (each application dashboard carries
    // its own grafana_instance_id), so group by instance and query each against its
    // own client instead of a single process-wide "first instance" client.
    if (panelsWithoutErrors.length > 0) {
      const groups = await groupPanelsByGrafanaInstance(this.db, panelsWithoutErrors, this.logger);
      this.logger.info(`🔍 Querying Grafana for ${panelsWithoutErrors.length} panels without errors across ${groups.length} instance(s)`);

      for (const group of groups) {
        try {
          const grafanaResults = await group.client.queryPanelData(group.panels, testRun);

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
          this.logger.error(`❌ Grafana query failed for instance ${group.instanceId ?? 'default'}:`, error);
          // Just log the error, don't store error records
          for (const panel of group.panels) {
            this.logger.error(`❌ Failed to query panel ${panel.panel_id} (${panel.panel_title}):`, error);
          }
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
  private flattenSingleDocument(document: PanelMetricsDocument, testRun: { start_time?: Date; end_time?: Date; ramp_up?: number; ramp_down?: number; organization_id?: string | null; team_id?: string | null }): unknown[] {
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

    const flattened: unknown[] = [];
    const dataRecords = document.data || [];

    if (dataRecords.length > 0) {
      // Normal case: document has data records
      for (const record of dataRecords) {
        // Calculate ramp_up flag based on test run timing
        let isRampUp = false;
        if (testRun.start_time) {
          const recordTime = new Date(record.time);
          const elapsedSeconds = (recordTime.getTime() - testRun.start_time.getTime()) / 1000;
          const startOffset = testRun.ramp_up ?? 0;
          const endOffset   = testRun.ramp_down ?? 0;
          const durationSeconds = testRun.end_time
            ? (testRun.end_time.getTime() - testRun.start_time.getTime()) / 1000
            : Infinity;
          isRampUp = elapsedSeconds < startOffset
            || (endOffset > 0 && elapsedSeconds > durationSeconds - endOffset);
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
  /**
   * Save flattened records directly to PostgreSQL with batch processing
   * Simplified version that works with pre-flattened records
   */
  private async saveRecordsToDatabase(records: unknown[]): Promise<void> {
    if (records.length === 0) {return;}

    // Use the dedicated write connection pool so metric inserts are never
    // starved by heavy analytical queries on the main pool.
    // See: 2026-03-26 write starvation post-mortem
    return this.writeTransaction(async (manager: EntityManager) => {
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
  private async batchInsertRecords(manager: EntityManager, records: unknown[]): Promise<void> {
    const batchSize = DB_INSERT_BATCH_SIZE;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await this.insertBatch(manager, batch);

      if (records.length > batchSize) {
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(records.length / batchSize);
        this.logger.debug(`Inserting batch ${batchNum}/${totalBatches}`);
      }
    }
  }

  /**
   * Insert a single batch of records using UPSERT pattern (matches Python TimescaleDB implementation)
   */
  private async insertBatch(manager: EntityManager, batch: unknown[]): Promise<void> {
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
    const params = batch.flatMap(record => {
      const r = record as Record<string, unknown>;
      return columns.map(col => {
        const val = r[col];
        const limit = varcharLimits[col];
        return (limit && typeof val === 'string') ? val.substring(0, limit) : val;
      });
    });

    await manager.query(sql, params);
  }

}