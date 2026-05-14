/**
 * Metric Processor for Incremental Metrics Pipeline
 *
 * Handles metric processing operations including:
 * - Flattening Grafana metrics documents to ds_metrics records
 * - Flattening Dynatrace metrics documents to ds_metrics records
 * - UPSERT operations for metrics to database
 * - Template variable replacement in DQL queries
 * - Time range cleaning from DQL queries
 *
 * This processor is responsible for transforming and persisting metrics
 * from various sources during incremental collection.
 */

import type { Logger } from 'pino';
import type { EntityManager } from 'typeorm';
import { WorkerDatabaseService } from '../../../common/database.service.js';

interface GrafanaMetricRecord {
  metric_name: string;
  time: Date | string;
  timestep: number | null;
  value: number;
  unit?: string | null;
}

interface GrafanaMetricsDoc {
  test_run_id: string;
  application_dashboard_id: string;
  metrics_source_id?: string | null;
  dashboard_uid: string;
  panel_id: number | string;
  panel_title: string;
  dashboard_label: string;
  benchmark_ids?: string[] | null;
  errors?: unknown;
  data?: GrafanaMetricRecord[];
}

interface DynatraceMetricRecord {
  metricName: string;
  time: Date | string;
  timestep: number | null;
  value: number;
  unit?: string | null;
}

interface DynatraceMetricsDoc {
  testRunId: string;
  applicationDashboardId: string;
  metricsSourceId?: string | null;
  dashboardUid: string;
  panelId: number | string;
  panelTitle: string;
  dashboardLabel: string;
  benchmarkIds?: string[] | null;
  errors?: unknown;
  data?: DynatraceMetricRecord[];
}

/**
 * Flattened metric record ready for database insertion
 */
export interface FlattenedMetricRecord {
  test_run_id: string;
  application_dashboard_id: string;
  metrics_source_id?: string | null;
  dashboard_uid: string | null;
  panel_id: string | number;
  panel_title: string;
  dashboard_label: string;
  benchmark_ids: string[] | null;
  errors: string | null;
  metric_name: string;
  time: string | Date;
  timestep: number | null;
  ramp_up: boolean;
  value: number | null;
  unit: string | null;
  organization_id?: string | null;
  team_id?: string | null;
  created_by?: string;
  updated_by?: string;
}

/**
 * Test run data used for timestep calculations
 */
export interface TestRunContext {
  startTime?: Date;
  analysisStartOffset?: number;
  organizationId?: string | null;
  teamId?: string | null;
}

/**
 * Metric Processor
 *
 * Manages metric processing operations for the Incremental Metrics Pipeline
 * including document flattening, database upserts, and query preprocessing.
 */
export class MetricProcessor {
  constructor(
    private logger: Logger,
    private db: WorkerDatabaseService
  ) {}

  /**
   * Flatten Grafana metrics document to individual ds_metrics records
   *
   * For incremental collection, recalculates timestep based on original test run start time
   * to ensure consistent timesteps across all increments.
   *
   * @param document - Grafana metrics document with panel data
   * @param testRun - Test run context for timestep calculations
   * @returns Array of flattened metric records
   */
  flattenGrafanaMetricsDocument(document: unknown, testRun: TestRunContext): FlattenedMetricRecord[] {
    const doc = document as GrafanaMetricsDoc;
    const baseData = {
      test_run_id: doc.test_run_id,
      application_dashboard_id: doc.application_dashboard_id,
      metrics_source_id: doc.metrics_source_id || null,
      dashboard_uid: doc.dashboard_uid,
      panel_id: doc.panel_id,
      panel_title: doc.panel_title,
      dashboard_label: doc.dashboard_label,
      benchmark_ids: doc.benchmark_ids ?? null,
      errors: doc.errors ? JSON.stringify(doc.errors) : null,
      organization_id: testRun.organizationId || null,
      team_id: testRun.teamId || null,
      created_by: 'worker-pipeline' as const,
      updated_by: 'worker-pipeline' as const,
    };

    const flattened: FlattenedMetricRecord[] = [];
    const dataRecords = doc.data || [];

    for (const record of dataRecords) {
      const recordTime = new Date(record.time);

      // Recalculate timestep based on ORIGINAL test run start time
      // This ensures consistent timesteps across all incremental collections
      let timestep: number | null = record.timestep;
      let isRampUp = false;

      if (testRun.startTime) {
        const elapsedSeconds = (recordTime.getTime() - testRun.startTime.getTime()) / 1000;
        timestep = elapsedSeconds;

        if (testRun.analysisStartOffset !== undefined) {
          isRampUp = elapsedSeconds < testRun.analysisStartOffset;
        }
      }

      flattened.push({
        ...baseData,
        metric_name: record.metric_name,
        time: record.time,
        timestep: timestep,
        ramp_up: isRampUp,
        value: record.value,
        unit: record.unit || null,
      });
    }

    return flattened;
  }

  /**
   * Flatten Dynatrace metrics document to individual ds_metrics records
   *
   * For incremental collection, recalculates timestep based on original test run start time
   * to ensure consistent timesteps across all increments.
   *
   * @param document - Dynatrace metrics document with panel data
   * @param testRun - Test run context for timestep calculations
   * @returns Array of flattened metric records
   */
  flattenDynatraceMetricsDocument(document: unknown, testRun: TestRunContext): FlattenedMetricRecord[] {
    const doc = document as DynatraceMetricsDoc;
    const baseData = {
      test_run_id: doc.testRunId,
      application_dashboard_id: doc.applicationDashboardId,
      metrics_source_id: doc.metricsSourceId || null,
      dashboard_uid: doc.dashboardUid,
      panel_id: doc.panelId,
      panel_title: doc.panelTitle,
      dashboard_label: doc.dashboardLabel,
      benchmark_ids: doc.benchmarkIds || null,
      errors: doc.errors ? JSON.stringify(doc.errors) : null,
      organization_id: testRun.organizationId || null,
      team_id: testRun.teamId || null,
      created_by: 'worker-pipeline' as const,
      updated_by: 'worker-pipeline' as const,
    };

    const flattened: FlattenedMetricRecord[] = [];
    const dataRecords = doc.data || [];

    for (const record of dataRecords) {
      const recordTime = new Date(record.time);

      // Recalculate timestep based on ORIGINAL test run start time
      // This ensures consistent timesteps across all incremental collections
      let timestep: number | null = record.timestep;
      let isRampUp = false;

      if (testRun.startTime) {
        const elapsedSeconds = (recordTime.getTime() - testRun.startTime.getTime()) / 1000;
        timestep = elapsedSeconds;

        if (testRun.analysisStartOffset !== undefined) {
          isRampUp = elapsedSeconds < testRun.analysisStartOffset;
        }
      }

      flattened.push({
        ...baseData,
        metric_name: record.metricName,
        time: record.time,
        timestep: timestep,
        ramp_up: isRampUp,
        value: record.value,
        unit: record.unit || null,
      });
    }

    return flattened;
  }

  /**
   * UPSERT metrics to database using batch processing
   *
   * Processes records in batches within a transaction to ensure consistency
   * and handle large datasets efficiently.
   *
   * @param records - Array of flattened metric records to upsert
   */
  async upsertMetricsToDatabase(records: FlattenedMetricRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.db.transaction(async (manager: EntityManager) => {
      const batchSize = 200; // Conservative batch size

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await this.upsertBatch(manager, batch);
      }
    });
  }

  /**
   * UPSERT a single batch of records
   *
   * Uses PostgreSQL ON CONFLICT to handle overlapping time ranges
   * by updating existing records with new values.
   *
   * @param manager - TypeORM EntityManager for transactional operations
   * @param batch - Batch of records to upsert
   */
  private async upsertBatch(manager: EntityManager, batch: FlattenedMetricRecord[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const columns = [
      'test_run_id',
      'application_dashboard_id',
      'metrics_source_id',
      'dashboard_uid',
      'panel_id',
      'panel_title',
      'dashboard_label',
      'benchmark_ids',
      'errors',
      'metric_name',
      'time',
      'timestep',
      'ramp_up',
      'value',
      'unit',
      'organization_id',
      'team_id',
      'created_by',
      'updated_by',
    ];

    // Generate VALUES clauses for bulk INSERT with UPSERT
    const values = batch
      .map(
        (_, index) =>
          `(${columns.map((_, colIndex) => `$${index * columns.length + colIndex + 1}`).join(', ')})`
      )
      .join(', ');

    // PostgreSQL UPSERT using ON CONFLICT
    // Note: created_at has a default value in DB, so we don't need to include it
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
        updated_at = CURRENT_TIMESTAMP,
        organization_id = EXCLUDED.organization_id,
        team_id = EXCLUDED.team_id,
        updated_by = EXCLUDED.updated_by
    `;

    // Flatten parameters for prepared statement
    const params = batch.flatMap((record) =>
      columns.map((col) => record[col as keyof FlattenedMetricRecord])
    );

    await manager.query(sql, params);
  }

  /**
   * Replace template variables in DQL query with actual values
   *
   * Substitutes $VariableName placeholders with quoted string values.
   * Example: $Cluster -> "other-k8s-2025-10-06-1759743420"
   *
   * @param query - DQL query string with template variables
   * @param variables - Map of variable names to values
   * @returns Query string with variables replaced
   */
  replaceTemplateVariables(query: string, variables: Record<string, unknown>): string {
    let processedQuery = query;

    for (const [key, value] of Object.entries(variables)) {
      // Replace $VariableName with quoted value
      // Use global regex to replace all occurrences
      // Escape regex special characters in key to prevent reDOS attacks
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\$${escapedKey}\\b`, 'g');
      const quotedValue = typeof value === 'string' ? `"${value}"` : String(value);
      processedQuery = processedQuery.replace(regex, quotedValue);
    }

    return processedQuery;
  }

  /**
   * Remove time range references from DQL query
   *
   * Timeframes should be in the API payload, not in the query string.
   * This method cleans various time range formats from DQL queries.
   *
   * @param query - DQL query string possibly containing time range specifiers
   * @returns Query string with time range references removed
   */
  cleanTimeRangeFromQuery(query: string): string {
    let processedQuery = query;

    // Remove from:/to: after limit commands: "| limit 20, from: ..." -> "| limit 20"
    processedQuery = processedQuery
      .replace(/(\|\s*limit\s+\d+),\s*from:\s*[^,\n|]+/g, '$1')
      .replace(/(\|\s*limit\s+\d+),\s*to:\s*[^,\n|]+/g, '$1');

    // Remove from:/to: from timeseries blocks
    processedQuery = processedQuery
      .replace(/,\s*from:\s*["'][^"']*["']/g, '')
      .replace(/,\s*to:\s*["'][^"']*["']/g, '')
      .replace(/,\s*from:\s*-?\d+[mhd]?/g, '')
      .replace(/,\s*to:\s*-?\d+[mhd]?/g, '');

    // Remove standalone from:/to: at end of lines
    processedQuery = processedQuery
      .replace(/,\s*from:\s*["'][^"']*["'](?=\s*$)/gm, '')
      .replace(/,\s*to:\s*["'][^"']*["'](?=\s*$)/gm, '');

    return processedQuery;
  }

  /**
   * Process and log metric document errors
   *
   * Extracts error messages from a metrics document and logs them.
   *
   * @param document - Metrics document possibly containing errors
   * @param source - Source identifier (e.g., 'Grafana', 'Dynatrace')
   * @param errors - Array to accumulate error messages
   * @returns True if the document has errors and should be skipped
   */
  processDocumentErrors(
    document: unknown,
    source: string,
    errors: string[]
  ): boolean {
    const doc = document as Record<string, unknown> & { errors?: Array<{ message?: string }> };
    if (doc.errors && doc.errors.length > 0) {
      const errorMessages = doc.errors
        .map((e) => e.message || JSON.stringify(e))
        .join('; ');
      const panelId = doc.panel_id || doc.panelId;
      const panelTitle = doc.panel_title || doc.panelTitle;
      this.logger.warn(
        `Skipping ${source} panel ${panelId} (${panelTitle}): ${errorMessages}`
      );
      errors.push(`Panel ${panelId}: ${errorMessages}`);
      return true;
    }
    return false;
  }

  /**
   * Check if a metrics document has data
   *
   * @param document - Metrics document to check
   * @param source - Source identifier for logging
   * @returns True if the document has no data and should be skipped
   */
  isEmptyDocument(document: unknown, source: string): boolean {
    const doc = document as Record<string, unknown> & { data?: unknown[] };
    if (!doc.data || doc.data.length === 0) {
      const panelId = doc.panel_id || doc.panelId;
      const panelTitle = doc.panel_title || doc.panelTitle;
      this.logger.warn(
        `Skipping ${source} panel ${panelId} (${panelTitle}) - no data in time range`
      );
      return true;
    }
    return false;
  }
}
