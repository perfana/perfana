import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import type { Logger } from 'pino';
import type {
  IncrementalMetricsInput,
  CollectionResult,
  IncrementalMetricsOutput,
} from './helpers/incremental/index.js';
import {
  IncrementalValidator,
  MetricProcessor,
  BatchProcessor,
  GrafanaCollector,
  DynatraceCollector,
  PerformanceTestCollector,
} from './helpers/incremental/index.js';

// Re-export types for external consumers
export type { IncrementalMetricsInput, CollectionResult, IncrementalMetricsOutput };

/**
 * Incremental Metrics Pipeline - Orchestrator
 *
 * Fetches metrics from Grafana, Dynatrace, and performance test tables
 * for a specific time range (incremental collection).
 *
 * Purpose:
 * - Supports real-time metric updates during test execution
 * - Enables incremental data collection without full re-processing
 * - Reduces load by fetching only new data since last collection
 *
 * Delegates all processing to specialized helper classes.
 */
export class IncrementalMetricsPipeline extends BasePipelineTypeORM {
  private validator: IncrementalValidator;
  private grafanaCollector: GrafanaCollector;
  private dynatraceCollector: DynatraceCollector;
  private perfTestCollector: PerformanceTestCollector;

  constructor(logger: Logger) {
    super(logger);
    this.validator = new IncrementalValidator();

    const metricProcessor = new MetricProcessor(logger, this.db);
    const batchProcessor = new BatchProcessor(logger, metricProcessor);

    this.grafanaCollector = new GrafanaCollector(logger, this.db, batchProcessor);
    this.dynatraceCollector = new DynatraceCollector(logger, this.db, metricProcessor, batchProcessor);
    this.perfTestCollector = new PerformanceTestCollector(logger);
  }

  /**
   * Execute incremental metrics collection
   */
  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    // Validate input
    const validationResult = this.validator.validateInput(input);
    if (!validationResult.valid) {
      return this.createErrorResult(validationResult.error || 'Invalid input', 'INVALID_INPUT');
    }

    const {
      testRunId,
      fromTime,
      toTime,
      grafanaInstanceId,
      applicationDashboardIds,
      metricsSourceIds,
      dynatraceConfigId,
      collectPerformanceTestMetrics = true,
      collectGrafanaMetrics = true,
      collectDynatraceMetrics = true,
    } = validationResult.input!;

    try {
      this.logger.info(
        `Starting incremental metrics collection for test run: ${testRunId} ` +
        `(${fromTime.toISOString()} -> ${toTime.toISOString()})`
      );

      // Load test run
      const testRun = await this.loadTestRun(testRunId);

      // Initialize results
      const results: IncrementalMetricsOutput = {
        testRunId,
        timeRange: { from: fromTime, to: toTime },
        grafana: this.validator.createDefaultCollectionResult(),
        dynatrace: this.validator.createDefaultCollectionResult(),
        performanceTest: this.validator.createDefaultCollectionResult(),
        totalDataPoints: 0,
        totalErrors: 0,
      };

      // Collect Grafana metrics
      if (collectGrafanaMetrics) {
        results.grafana = await this.grafanaCollector.collect(
          testRunId,
          testRun,
          grafanaInstanceId,
          applicationDashboardIds,
          metricsSourceIds,
          fromTime,
          toTime
        );
      }

      // Collect Dynatrace metrics
      if (collectDynatraceMetrics) {
        results.dynatrace = await this.dynatraceCollector.collect(
          testRunId,
          testRun,
          dynatraceConfigId,
          applicationDashboardIds,
          metricsSourceIds,
          fromTime,
          toTime
        );
      }

      // Collect performance test metrics
      if (collectPerformanceTestMetrics) {
        results.performanceTest = await this.perfTestCollector.collect(testRunId, fromTime, toTime);
      }

      // Calculate totals
      results.totalDataPoints =
        results.grafana.dataPoints + results.dynatrace.dataPoints + results.performanceTest.dataPoints;
      results.totalErrors =
        results.grafana.errors.length + results.dynatrace.errors.length + results.performanceTest.errors.length;

      const duration = Date.now() - startTime;

      this.logger.info(
        `Incremental metrics collection completed: ${results.totalDataPoints} data points, ` +
        `${results.totalErrors} errors in ${(duration / 1000).toFixed(2)}s`
      );

      return this.createSuccessResult(results, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { testRunId, duration });

      return this.createErrorResult(
        error as Error,
        'INCREMENTAL_METRICS_ERROR',
        { testRunId },
        duration
      );
    }
  }
}
