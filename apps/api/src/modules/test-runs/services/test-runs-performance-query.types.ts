// apps/api/src/modules/test-runs/services/test-runs-performance-query.types.ts

/**
 * Status returned when an Apdex query cannot be served from the rollup
 * table because the post-test analyze-test job is still in-flight. The
 * controller maps this to HTTP 202 so callers (web, MCP, scripts) can
 * render an informative pending state instead of stalling the DB on the
 * live-aggregation fallback.
 */
export interface RollupPendingResult {
  status: 'rollup-pending';
  stage: 'transaction-stats-rollup';
  /** Optional progress hint, when JobProgressService can supply one */
  progress?: {
    stageName: string;
    stageIndex: number;
    totalStages: number;
  };
}

export function isRollupPending(value: unknown): value is RollupPendingResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value as { status?: unknown }).status === 'rollup-pending'
  );
}
