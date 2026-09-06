import { z } from 'zod';
import { JobsOptions } from 'bullmq';
import { PRIORITY_LEVELS as _PRIORITY_LEVELS, getJobPriority as _getJobPriority, type PriorityLevel } from '../config/priorities.js';

// Base job result interface
export interface JobResult {
  status: 'success' | 'failed' | 'partial';
  message?: string;
  data?: Record<string, unknown>;
  errors?: Array<{
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  }>;
}

// Job payload schemas with validation
export const AnalyzeTestJobSchema = z.object({
  testRunId: z.string(),
  adapt: z.boolean().default(true),
  benchmarksOnly: z.boolean().default(false),
});

export const BatchProcessingJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  adapt: z.boolean().default(true),
  dependencies: z.array(z.string()).optional(),
});

export const ReevaluateJobSchema = z.object({
  testRunId: z.string(),
  updateBenchmarkIds: z.boolean().default(true),
});

export const MetricsCollectionJobSchema = z.object({
  testRunId: z.string(),
  benchmarksOnly: z.boolean().default(false),
  panelDocuments: z.array(z.unknown()).optional(),
});

export const StatisticsJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
});

export const ControlGroupsJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
});

export const AdaptJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  updateControlGroup: z.boolean().default(true),
  updateControlStatistics: z.boolean().default(true),
  // Optional: Filter to specific metric for re-evaluation
  applicationDashboardId: z.string().uuid().optional(),
  panelId: z.number().int().positive().optional(),
  metricName: z.string().optional(),
});

export const ChecksJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  // Optional: Filter to specific metric for re-evaluation
  applicationDashboardId: z.string().uuid().optional(),
  panelId: z.number().int().positive().optional(),
  metricName: z.string().optional(),
});

// Batch processing schemas
export const BatchAnalysisJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  adapt: z.boolean().default(true),
  batchId: z.string(),
  batchIndex: z.number().min(0),
  totalBatches: z.number().min(1),
});

export const BatchFlowJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  adapt: z.boolean().default(true),
  dependencies: z.array(z.string()).optional(),
  batchId: z.string(),
  batchSize: z.number().min(1).max(50).default(10),
});

export const ReevaluationBatchJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  updateBenchmarkIds: z.boolean().default(true),
  batchId: z.string(),
  batchSize: z.number().min(1).max(25).default(15),
});

export const OrchestrateReevaluateBatchJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
  batchId: z.string(),
  checks: z.boolean().default(true),
  adapt: z.boolean().default(true),
  // When 'missing-data': detect gaps via MetricCollectionGapService, fill only missing ranges
  // When 'force': re-collect ALL metrics for the full test run time range, replacing existing data
  // When absent: reevaluate only (skip data collection entirely)
  refreshMode: z.enum(['missing-data', 'force']).optional(),
  // Filter which sources to check for gaps (only relevant when refreshMode === 'missing-data')
  // When omitted, all sources are included (backward compatible)
  sources: z.object({
    grafana: z.boolean().optional(),
    dynatrace: z.boolean().optional(),
    performanceMetrics: z.boolean().optional(),
  }).optional(),
  // Recalculate ds_metric_statistics before evaluating, without collecting any data.
  // The two refreshMode branches run statistics only when a fetch actually returned
  // new rows, so neither covers the case where the DATA is unchanged but the
  // ANALYSIS WINDOW moved (test_runs.ramp_up / ramp_down edited in the UI).
  // StatisticsPipeline rebakes ds_metrics.ramp_up from the run's current offsets and
  // rewrites ds_metric_statistics, which is what makes the new window take effect.
  recalculateStatistics: z.boolean().optional(),
  // Optional: Filter to specific metric for re-evaluation
  applicationDashboardId: z.string().uuid().optional(),
  panelId: z.number().int().positive().optional(),
  metricName: z.string().optional(),
});

/**
 * Result of a single gap-fill action for a specific source and time range
 */
export interface GapFillAction {
  sourceType: string;
  sourceId: string | null;
  rangeFrom: string;
  rangeTo: string;
  status: 'collected' | 'no-data' | 'failed';
  dataPoints: number;
  error?: string;
}

/**
 * Gap analysis result for a single test run
 */
export interface TestRunGapAnalysis {
  testRunId: string;
  sourcesAnalyzed: number;
  gapsFound: number;
  coverageBefore: number;
  coverageAfter: number;
  actions: GapFillAction[];
}

export const IncrementalCollectionJobSchema = z.object({
  testRunId: z.string(),
  sourceType: z.enum(['grafana', 'dynatrace', 'performance_test']),
  sourceId: z.string().nullable(),
  applicationDashboardIds: z.array(z.string()),
  fromTime: z.string(), // ISO 8601 timestamp
  toTime: z.string(),   // ISO 8601 timestamp
  attempt: z.number().int().min(1).default(1),
  maxAttempts: z.number().int().min(1).default(5),
});

export const TransactionStatsRollupJobSchema = z.object({
  testRunId: z.string().min(1),
});

// Inferred types from schemas
export type AnalyzeTestJob = z.infer<typeof AnalyzeTestJobSchema>;
export type IncrementalCollectionJob = z.infer<typeof IncrementalCollectionJobSchema>;

// Job names as constants
export const JOB_NAMES = {
  ANALYZE_TEST: 'analyze-test',
  METRICS_COLLECTION: 'metrics-collection',
  STATISTICS_PIPELINE: 'statistics-calculation',
  CONTROL_GROUPS_PIPELINE: 'control-groups-pipeline',
  CONTROL_GROUP_STATISTICS: 'control-group-statistics',
  ADAPT_PIPELINE: 'adapt-analysis',
  CHECKS_EVALUATION: 'checks-evaluation',
  PANELS_PROCESSING: 'panels-processing',
  PERFORMANCE_TEST_METRICS: 'performance-test-metrics',
  DYNATRACE_COLLECTION: 'dynatrace-collection',
  REEVALUATE_CHECKS: 'reevaluate-checks',

  // New job types for enhanced BullMQ implementation
  BATCH_ANALYSIS: 'batch-analysis',
  BATCH_FLOW: 'batch-flow',
  REEVALUATION_BATCH: 'reevaluation-batch',
  ORCHESTRATE_REEVALUATE_BATCH: 'orchestrate-reevaluate-batch',

  // Incremental collection for in-progress test runs
  INCREMENTAL_COLLECTION: 'collect-metrics-incremental',

  // Per-test-run transaction/sampler stats rollup (#150, #151)
  TRANSACTION_STATS_ROLLUP: 'transaction-stats-rollup',
} as const;

export type JobName = typeof JOB_NAMES[keyof typeof JOB_NAMES];

/**
 * Enhanced job options with Perfana-specific configuration
 * UPDATED: Uses standardized numeric priority system
 */
export interface EnhancedJobOptions extends JobsOptions {
  // Perfana-specific options
  priority?: PriorityLevel; // DISABLED: Job priorities force Lua scripts, breaking BRPOPLPUSH blocking mode
  pipeline_stage?: number;
  dependencies?: string[];
  timeout: number;
  resource_requirements: {
    memory_mb: number;
    cpu_cores: number;
    io_intensive: boolean;
  };

  // Pipeline context
  testRunId?: string;
  batchId?: string;
  parentJobId?: string;
}

/**
 * Enhanced job configurations with detailed resource requirements and timeouts
 * UPDATED: Uses standardized priority system and improved timeout handling
 */
export const ENHANCED_JOB_CONFIGS: Record<string, EnhancedJobOptions> = {
  'analyze-test': {
    pipeline_stage: 0,
    timeout: 1800000,                   // FIXED: 30 minutes for full pipeline
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20, // Increased for critical jobs
    resource_requirements: {
      memory_mb: 512,
      cpu_cores: 2,
      io_intensive: true
    }
  },

  'metrics-collection': {
    pipeline_stage: 3,
    timeout: 600000,                    // 10 minutes
    attempts: 5,                        // High retry for API calls
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 25,
    resource_requirements: {
      memory_mb: 256,
      cpu_cores: 1,
      io_intensive: true                // Grafana API calls
    }
  },

  'statistics-calculation': {
    pipeline_stage: 4,
    timeout: 300000,                    // 5 minutes
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 75,
    removeOnFail: 15,
    resource_requirements: {
      memory_mb: 384,
      cpu_cores: 2,
      io_intensive: false               // CPU intensive calculations
    }
  },

  'checks-evaluation': {
    pipeline_stage: 5,
    timeout: 180000,                    // 3 minutes
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 20,
    resource_requirements: {
      memory_mb: 256,
      cpu_cores: 1,
      io_intensive: false
    }
  },

  'adapt-analysis': {
    pipeline_stage: 6,
    timeout: 480000,                    // 8 minutes
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 15,
    resource_requirements: {
      memory_mb: 768,
      cpu_cores: 3,
      io_intensive: false               // CPU and memory intensive
    }
  },

  'panels-processing': {
    pipeline_stage: 2,
    timeout: 240000,                    // 4 minutes
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 75,
    removeOnFail: 15,
    resource_requirements: {
      memory_mb: 256,
      cpu_cores: 1,
      io_intensive: true                // Database operations
    }
  },

  'dynatrace-collection': {
    pipeline_stage: 1,
    timeout: 300000,                    // 5 minutes
    attempts: 4,                        // External API, higher retry
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 50,
    removeOnFail: 10,
    resource_requirements: {
      memory_mb: 192,
      cpu_cores: 1,
      io_intensive: true                // External API calls
    }
  },

  'reevaluate-checks': {
    pipeline_stage: 0,
    timeout: 120000,                    // 2 minutes (faster, reuses data)
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 10,
    resource_requirements: {
      memory_mb: 256,
      cpu_cores: 1,
      io_intensive: false
    }
  },

  'control-groups-pipeline': {
    pipeline_stage: 7,
    timeout: 240000,                    // 4 minutes
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 10,
    resource_requirements: {
      memory_mb: 320,
      cpu_cores: 2,
      io_intensive: false
    }
  },

  // Batch job configurations
  'batch-analysis': {
    timeout: 1800000,                   // 30 minutes for batch
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: 10,
    removeOnFail: 5,
    resource_requirements: {
      memory_mb: 128,
      cpu_cores: 1,
      io_intensive: false
    }
  },

  'batch-flow': {
    timeout: 1200000,                   // 20 minutes
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 15,
    removeOnFail: 5,
    resource_requirements: {
      memory_mb: 256,
      cpu_cores: 1,
      io_intensive: false
    }
  },

  'reevaluation-batch': {
    timeout: 900000,                    // 15 minutes (optimized)
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 10,
    removeOnFail: 5,
    resource_requirements: {
      memory_mb: 192,
      cpu_cores: 1,
      io_intensive: false
    }
  },

  'orchestrate-reevaluate-batch': {
    timeout: 1500000,                   // 25 minutes (checks + ADAPT with sequencing)
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 10,
    removeOnFail: 5,
    resource_requirements: {
      memory_mb: 512,
      cpu_cores: 2,
      io_intensive: false
    }
  },

  'collect-metrics-incremental': {
    pipeline_stage: 3,
    timeout: 300000,                    // 5 minutes (shorter than full collection)
    attempts: 5,                        // High retry for real-time collection
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 200,              // Keep more completed jobs for debugging
    removeOnFail: 50,                   // Keep failed jobs for analysis
    resource_requirements: {
      memory_mb: 256,
      cpu_cores: 1,
      io_intensive: true                // API calls to Grafana/Dynatrace
    }
  },

  'transaction-stats-rollup': {
    pipeline_stage: 4,                  // After performance-test-metrics, before statistics-calculation
    timeout: 600000,                    // 10 minutes (aggregation over 10M+ rows)
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 15,
    resource_requirements: {
      memory_mb: 512,                   // work_mem = 512MB during aggregation
      cpu_cores: 2,
      io_intensive: true                // Heavy reads from requests_raw / transactions
    }
  }
};