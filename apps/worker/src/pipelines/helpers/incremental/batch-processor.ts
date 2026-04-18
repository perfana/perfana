/**
 * Batch Processor for Incremental Metrics Pipeline
 *
 * Handles batch processing of metrics documents from various sources (Grafana, Dynatrace).
 * Provides a unified interface for:
 * - Processing metrics documents in configurable batch sizes
 * - Flattening documents to database records
 * - Tracking statistics and errors
 * - Coordinating upsert operations
 *
 * This processor abstracts the common batch processing pattern used across
 * different metric collection sources in the Incremental Metrics Pipeline.
 */

import type { Logger } from 'pino';
import type { MetricProcessor, FlattenedMetricRecord, TestRunContext } from './metric-processor.js';

/**
 * Source type for metrics documents
 */
export type MetricSource = 'Grafana' | 'Dynatrace';

/**
 * Configuration for batch processing
 */
export interface BatchProcessorConfig {
  /**
   * Number of documents to process per batch
   * @default 50
   */
  documentBatchSize?: number;

  /**
   * Whether to continue processing on document errors
   * @default true
   */
  continueOnError?: boolean;
}

/**
 * Result of batch processing operation
 */
export interface BatchProcessResult {
  /**
   * Total number of metric records processed
   */
  totalRecords: number;

  /**
   * Number of documents successfully processed
   */
  documentsProcessed: number;

  /**
   * Number of documents skipped (errors or empty)
   */
  documentsSkipped: number;

  /**
   * Error messages collected during processing
   */
  errors: string[];

  /**
   * Maximum timestamp from processed data
   */
  maxDataTimestamp?: Date;
}

/**
 * Batch Processor
 *
 * Manages batch processing of metrics documents for the Incremental Metrics Pipeline.
 * Provides a unified interface for processing Grafana and Dynatrace metrics with
 * consistent error handling, statistics tracking, and database operations.
 */
export class BatchProcessor {
  private readonly documentBatchSize: number;
  private readonly continueOnError: boolean;

  constructor(
    private logger: Logger,
    private metricProcessor: MetricProcessor,
    config: BatchProcessorConfig = {}
  ) {
    this.documentBatchSize = config.documentBatchSize ?? 50;
    this.continueOnError = config.continueOnError ?? true;
  }

  /**
   * Process a batch of Grafana metrics documents
   *
   * Flattens documents to individual metric records and upserts them to the database.
   * Tracks statistics and errors for reporting.
   *
   * @param documents - Array of Grafana metrics documents
   * @param testRun - Test run context for timestep calculations
   * @returns Batch processing result with statistics
   */
  async processGrafanaDocuments(
    documents: unknown[],
    testRun: TestRunContext
  ): Promise<BatchProcessResult> {
    return this.processDocuments(documents, testRun, 'Grafana', (doc) =>
      this.metricProcessor.flattenGrafanaMetricsDocument(doc, testRun)
    );
  }

  /**
   * Process a batch of Dynatrace metrics documents
   *
   * Flattens documents to individual metric records and upserts them to the database.
   * Tracks statistics and errors for reporting.
   *
   * @param documents - Array of Dynatrace metrics documents
   * @param testRun - Test run context for timestep calculations
   * @returns Batch processing result with statistics
   */
  async processDynatraceDocuments(
    documents: unknown[],
    testRun: TestRunContext
  ): Promise<BatchProcessResult> {
    return this.processDocuments(documents, testRun, 'Dynatrace', (doc) =>
      this.metricProcessor.flattenDynatraceMetricsDocument(doc, testRun)
    );
  }

  /**
   * Process documents from any source with a custom flattening function
   *
   * Core batch processing logic that:
   * 1. Processes documents in batches
   * 2. Skips documents with errors or no data
   * 3. Flattens valid documents to metric records
   * 4. Tracks max timestamp from data
   * 5. Upserts records to database
   *
   * @param documents - Array of metrics documents to process
   * @param testRun - Test run context for timestep calculations
   * @param source - Source identifier for logging
   * @param flattenFn - Function to flatten a document to metric records
   * @returns Batch processing result with statistics
   */
  private async processDocuments(
    documents: unknown[],
    testRun: TestRunContext,
    source: MetricSource,
    flattenFn: (doc: any) => FlattenedMetricRecord[]
  ): Promise<BatchProcessResult> {
    const result: BatchProcessResult = {
      totalRecords: 0,
      documentsProcessed: 0,
      documentsSkipped: 0,
      errors: [],
      maxDataTimestamp: undefined,
    };

    if (!documents || documents.length === 0) {
      this.logger.debug(`No ${source} documents to process`);
      return result;
    }

    this.logger.info(`📦 Processing ${documents.length} ${source} documents in batches of ${this.documentBatchSize}`);

    // Process documents in batches
    for (let i = 0; i < documents.length; i += this.documentBatchSize) {
      const batch = documents.slice(i, Math.min(i + this.documentBatchSize, documents.length));
      const batchResult = await this.processSingleBatch(batch, testRun, source, flattenFn);

      // Accumulate results
      result.totalRecords += batchResult.totalRecords;
      result.documentsProcessed += batchResult.documentsProcessed;
      result.documentsSkipped += batchResult.documentsSkipped;
      result.errors.push(...batchResult.errors);

      // Track max timestamp
      if (batchResult.maxDataTimestamp) {
        if (!result.maxDataTimestamp || batchResult.maxDataTimestamp > result.maxDataTimestamp) {
          result.maxDataTimestamp = batchResult.maxDataTimestamp;
        }
      }

      // Check if we should stop on error
      if (!this.continueOnError && batchResult.errors.length > 0) {
        this.logger.warn(`Stopping batch processing due to errors (continueOnError=false)`);
        break;
      }
    }

    this.logger.info(
      `✅ ${source} batch processing complete: ${result.totalRecords} records, ` +
      `${result.documentsProcessed} documents processed, ${result.documentsSkipped} skipped`
    );

    return result;
  }

  /**
   * Process a single batch of documents
   *
   * @param batch - Array of documents in this batch
   * @param testRun - Test run context
   * @param source - Source identifier
   * @param flattenFn - Flattening function
   * @returns Batch result for this batch only
   */
  private async processSingleBatch(
    batch: unknown[],
    testRun: TestRunContext,
    source: MetricSource,
    flattenFn: (doc: any) => FlattenedMetricRecord[]
  ): Promise<BatchProcessResult> {
    const result: BatchProcessResult = {
      totalRecords: 0,
      documentsProcessed: 0,
      documentsSkipped: 0,
      errors: [],
      maxDataTimestamp: undefined,
    };

    const flattenedRecords: FlattenedMetricRecord[] = [];

    for (const doc of batch) {
      try {
        // Skip documents with errors
        if (this.metricProcessor.processDocumentErrors(doc, source, result.errors)) {
          result.documentsSkipped++;
          continue;
        }

        // Skip documents with no data
        if (this.metricProcessor.isEmptyDocument(doc, source)) {
          result.documentsSkipped++;
          continue;
        }

        // Flatten document to records
        const records = flattenFn(doc);

        if (records.length > 0) {
          flattenedRecords.push(...records);

          // Track max timestamp from records
          for (const record of records) {
            if (record.time) {
              const recordTime = new Date(record.time);
              if (!result.maxDataTimestamp || recordTime > result.maxDataTimestamp) {
                result.maxDataTimestamp = recordTime;
              }
            }
          }
        }

        result.documentsProcessed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const docId = this.getDocumentIdentifier(doc);
        this.logger.error(`Failed to process ${source} document ${docId}: ${errorMessage}`);
        result.errors.push(`Document ${docId}: ${errorMessage}`);
        result.documentsSkipped++;

        if (!this.continueOnError) {
          throw error;
        }
      }
    }

    // Upsert all flattened records from this batch
    if (flattenedRecords.length > 0) {
      await this.metricProcessor.upsertMetricsToDatabase(flattenedRecords);
      result.totalRecords = flattenedRecords.length;
    }

    return result;
  }

  /**
   * Extract a human-readable identifier from a document for logging
   *
   * @param doc - Document to identify
   * @returns String identifier for the document
   */
  private getDocumentIdentifier(doc: any): string {
    const d = doc as any;
    // Try various common ID fields
    const panelId = d.panel_id || d.panelId;
    const panelTitle = d.panel_title || d.panelTitle;
    const dashboardLabel = d.dashboard_label || d.dashboardLabel;

    if (panelId && panelTitle) {
      return `${panelId} (${panelTitle})`;
    }
    if (panelId) {
      return String(panelId);
    }
    if (dashboardLabel) {
      return dashboardLabel;
    }
    return 'unknown';
  }
}
