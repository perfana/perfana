/**
 * Incremental Metrics Pipeline Helpers
 *
 * This module re-exports all types and utilities for the Incremental Metrics
 * Pipeline, which handles real-time metric collection during test execution.
 */

// Types and interfaces
export type {
  IncrementalMetricsInput,
  CollectionResult,
  IncrementalMetricsOutput,
} from './types.js';

// Validator
export {
  IncrementalValidator,
  type InputValidationResult,
} from './incremental-validator.js';

// Processors
export { MetricProcessor } from './metric-processor.js';
export type {
  FlattenedMetricRecord,
  TestRunContext,
} from './metric-processor.js';

// Batch processing
export { BatchProcessor } from './batch-processor.js';
export type {
  MetricSource,
  BatchProcessorConfig,
  BatchProcessResult,
} from './batch-processor.js';

// Collectors
export { GrafanaCollector } from './grafana-collector.js';
export { DynatraceCollector } from './dynatrace-collector.js';
export { PerformanceTestCollector } from './perf-test-collector.js';
