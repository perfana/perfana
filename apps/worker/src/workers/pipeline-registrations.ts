/**
 * Pipeline Registrations - Self-registering module
 *
 * Importing this file registers all simple pipeline workers with the registry.
 * Complex workers (analyze, incremental-metrics, simple-orchestrate-reevaluate-batch)
 * are NOT included here — they have custom logic beyond the standard pattern.
 */

import { registerPipeline } from './pipeline-registry.js';
import { JOB_NAMES } from '../types/jobs.js';
import {
  AdaptJobSchema,
  MetricsCollectionJobSchema,
  StatisticsJobSchema,
  ControlGroupsJobSchema,
  ChecksJobSchema,
  ReevaluateJobSchema,
  TransactionStatsRollupJobSchema,
} from '../types/jobs.js';

// Local schema (not in jobs.ts)
import { z } from 'zod';

const ControlGroupStatisticsJobSchema = z.object({
  controlGroupIds: z.array(z.string()).optional(),
  testRunIds: z.array(z.string()).optional(),
}).refine(
  data => (data.controlGroupIds && data.controlGroupIds.length > 0) ||
          (data.testRunIds && data.testRunIds.length > 0),
  { message: 'Either controlGroupIds or testRunIds must be provided' },
);

// Pipeline classes
import { AdaptPipeline } from '../pipelines/AdaptPipeline.js';
import { MetricsPipeline } from '../pipelines/MetricsPipeline.js';
import { StatisticsPipeline } from '../pipelines/StatisticsPipeline.js';
import { ChecksPipeline } from '../pipelines/ChecksPipeline.js';
import { PanelsPipeline } from '../pipelines/PanelsPipeline.js';
import { ControlGroupsPipeline } from '../pipelines/ControlGroupsPipeline.js';
import { ControlGroupStatisticsPipeline } from '../pipelines/ControlGroupStatisticsPipeline.js';
import { DynatracePipeline } from '../pipelines/DynatracePipeline.js';
import { PerformanceTestMetricsPipeline } from '../pipelines/PerformanceTestMetricsPipeline.js';
import { TransactionStatsRollupPipeline } from '../pipelines/TransactionStatsRollupPipeline.js';

// ── Standard schema-validated pipelines ──────────────────────────────

registerPipeline({
  jobName: JOB_NAMES.ADAPT_PIPELINE,
  schema: AdaptJobSchema,
  createPipeline: (logger) => new AdaptPipeline(logger),
  successMessage: 'ADAPT pipeline',
});

registerPipeline({
  jobName: JOB_NAMES.METRICS_COLLECTION,
  schema: MetricsCollectionJobSchema,
  createPipeline: (logger) => new MetricsPipeline(logger),
  successMessage: 'Metrics collection',
});

registerPipeline({
  jobName: JOB_NAMES.STATISTICS_PIPELINE,
  schema: StatisticsJobSchema,
  createPipeline: (logger) => new StatisticsPipeline(logger),
  successMessage: 'Statistics',
});

registerPipeline({
  jobName: JOB_NAMES.CONTROL_GROUPS_PIPELINE,
  schema: ControlGroupsJobSchema,
  createPipeline: (logger) => new ControlGroupsPipeline(logger),
  successMessage: 'Control groups',
});

registerPipeline({
  jobName: JOB_NAMES.CHECKS_EVALUATION,
  schema: ChecksJobSchema,
  createPipeline: (logger) => new ChecksPipeline(logger),
  successMessage: 'Checks',
});

// ── Pipelines with custom behavior ──────────────────────────────────

// Control group statistics: soft-fail (returns failed status instead of throwing)
registerPipeline({
  jobName: JOB_NAMES.CONTROL_GROUP_STATISTICS,
  schema: ControlGroupStatisticsJobSchema,
  createPipeline: (logger) => new ControlGroupStatisticsPipeline(logger),
  successMessage: 'Control group statistics',
  softFail: true,
});

// Panels: no Zod schema, uses pipeline.validateInput()
registerPipeline({
  jobName: JOB_NAMES.PANELS_PROCESSING,
  createPipeline: (logger) => new PanelsPipeline(logger),
  successMessage: 'Panels',
});

// Dynatrace: no Zod schema, converts testRunId to testRunIds array, uses pipeline.validateInput()
registerPipeline({
  jobName: JOB_NAMES.DYNATRACE_COLLECTION,
  createPipeline: (logger) => new DynatracePipeline(logger),
  transformInput: (data: unknown) => ({ testRunIds: [(data as { testRunId: string }).testRunId] }),
  successMessage: 'Dynatrace collection',
});

// Performance test metrics: no Zod schema, passes raw data
registerPipeline({
  jobName: JOB_NAMES.PERFORMANCE_TEST_METRICS,
  createPipeline: (logger) => new PerformanceTestMetricsPipeline(logger),
  successMessage: 'Performance test metrics',
});

// Transaction stats rollup (#150, #151): per-test-run aggregates written to
// test_run_transaction_stats + test_run_sampler_stats at finalization.
registerPipeline({
  jobName: JOB_NAMES.TRANSACTION_STATS_ROLLUP,
  schema: TransactionStatsRollupJobSchema,
  createPipeline: (logger) => new TransactionStatsRollupPipeline(logger),
  successMessage: 'Transaction stats rollup',
});

// Reevaluate: logs a warning instead of silently succeeding
registerPipeline({
  jobName: JOB_NAMES.REEVALUATE_CHECKS,
  schema: ReevaluateJobSchema,
  createPipeline: (logger) => ({
    execute: async (data: unknown) => {
      const d = data as { testRunId: string };
      logger.warn({ testRunId: d.testRunId }, 'REEVALUATE_CHECKS pipeline not yet implemented — job skipped');
      return {
        success: false,
        error: 'REEVALUATE_CHECKS pipeline not yet implemented',
        data: { testRunId: d.testRunId },
      };
    },
  }),
  softFail: true,
  successMessage: 'Reevaluate',
});
