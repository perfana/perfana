// Job names that match the ds-next-gen worker job names
export const JOB_NAMES = {
  // Orchestration jobs (handled by this API)
  ORCHESTRATE_REFRESH_BATCH: 'orchestrate-refresh-batch',
  ORCHESTRATE_REEVALUATE_BATCH: 'orchestrate-reevaluate-batch',

  // Worker jobs (handled by ds-next-gen workers)
  ANALYZE_TEST: 'analyze-test',
  REEVALUATE_CHECKS: 'reevaluate-checks',
  UPDATE_CONTROL_GROUP: 'update-control-group',
  UPDATE_STATISTICS: 'update-statistics',
  UPDATE_ADAPT: 'update-adapt',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];