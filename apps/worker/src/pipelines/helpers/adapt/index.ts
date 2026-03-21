/**
 * ADAPT Pipeline Helpers
 *
 * This module re-exports all types and utilities for the ADAPT
 * (Automated Detection of Anomalies in Performance Tests) pipeline.
 */

// Types and interfaces
export type {
  AdaptInput,
  ThresholdConfig,
  MetricClassification,
  CompareConfig,
  StatisticResult,
  ThresholdCheckResult,
  ThresholdChecks,
  AdaptConclusion,
} from './types.js';

// Validator
export {
  AdaptValidator,
  formatSubstageBreakdown,
  type InputValidationResult,
  type PreProcessingValidationResult,
  type SubstageEntry,
} from './adapt-validator.js';

// Compare Config Cache
export {
  CompareConfigCache,
  DEFAULT_COMPARE_CONFIG,
  type TempConfigCacheResult,
} from './compare-config-cache.js';

// Control Group Processor
export { ControlGroupProcessor } from './control-group-processor.js';

// Statistics Processor
export { StatisticsProcessor } from './statistics-processor.js';

// Results Processor
export {
  ResultsProcessor,
  type ProcessAdaptResultsOutput,
  type GenerateConclusionsOutput,
  type StoreTrackedResultsOutput,
  type MetricFilter,
} from './results-processor.js';
