/**
 * Batch-size limits for work that is done in one transaction per job.
 *
 * Lives here rather than in the orchestrator so a pipeline can import it without
 * dragging BullMQ and Redis in with it — and so the orchestrator and
 * ControlGroupStatisticsPipeline cannot drift to two different numbers while bounding
 * the same budget.
 */

/**
 * How many test runs may share one ADAPT / statistics / control-group-statistics job.
 *
 * Both downstream pipelines do their work in a SINGLE transaction over every id they are
 * handed, and both have a per-transaction ceiling that scales with the batch:
 *
 *  - `AdaptPipeline` never calls `setAggregationBudget`, so it runs on the 120 s
 *    `ANALYTICS_STATEMENT_TIMEOUT_MS` cap. CLAUDE.md's measurement is ~13 s/run with JIT
 *    off and says outright that "a 9-run batch already exceeds the 120s cap"; v0.2.94.7
 *    then added the orphan-results DELETE to that same transaction, so the per-run figure
 *    is now a floor rather than an estimate.
 *  - `StatisticsPipeline.refreshRampUpFlags` issues one UPDATE per run but they all share
 *    a single transaction's `max_tuples_decompressed_per_dml_transaction` (100 000). An
 *    analysis-window edit invalidates every run's ramp_up flags at once, which is the
 *    documented recipe for `tuple decompression limit exceeded`.
 *
 * 5 leaves roughly half the ADAPT budget as headroom for the added DELETE and for runs
 * larger than the one that was measured.
 */
export const REEVALUATE_CHUNK_SIZE = (() => {
  const raw = Number(process.env.REEVALUATE_CHUNK_SIZE);
  // Explicit finite check rather than `|| 5`: that turns a deliberate 0 into 5 silently,
  // and floor() because slice() with a fractional size chunks unpredictably.
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 5;
})();

/** Split ids into chunks of at most `size`, preserving order. */
export function chunkTestRunIds(ids: string[], size: number = REEVALUATE_CHUNK_SIZE): string[][] {
  // No chunks for no ids. Returning [[]] would enqueue a pipeline job with an empty
  // testRunIds and make the progress arithmetic divide by zero.
  if (ids.length === 0) { return []; }
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}
