/**
 * Transaction-scoped budget for a heavy aggregation over ds_metrics / requests_raw.
 *
 * Leaf module so a helper that only has a DataSource (perf-metrics-writer) can share
 * it with BasePipelineTypeORM.setAggregationBudget. Call it as the FIRST statement of
 * the transaction: `set_config(..., true)` is transaction-local, so anything issued
 * before it still runs under the pool default (120 s / work_mem 4MB).
 *
 * Mirrored in config/environment.ts (AGGREGATION_STATEMENT_TIMEOUT_MS /
 * AGGREGATION_WORK_MEM) so a bad value is rejected at boot. Read from process.env
 * rather than getConfig() because the full schema requires secrets a unit test has
 * no reason to provide — the same reason TransactionStatsRollupPipeline reads
 * ROLLUP_STATEMENT_TIMEOUT_MS directly.
 *
 * 540s, not 600s: the analytics pool sets a client-side query_timeout of 600000
 * (config/typeorm.config.ts). At equal deadlines node-postgres tears the connection
 * down instead of letting Postgres cancel the statement, so you lose the clean
 * rollback and get a torn socket instead of `canceling statement due to ...`.
 */
import type { DataSource, EntityManager } from 'typeorm';

const AGGREGATION_STATEMENT_TIMEOUT_DEFAULT_MS = 540000;
const AGGREGATION_WORK_MEM_DEFAULT = '128MB';

export async function applyAggregationBudget(manager: EntityManager): Promise<void> {
  const parsed = Number.parseInt(process.env.AGGREGATION_STATEMENT_TIMEOUT_MS ?? '', 10);
  const timeoutMs = Number.isFinite(parsed) ? parsed : AGGREGATION_STATEMENT_TIMEOUT_DEFAULT_MS;
  const workMem = process.env.AGGREGATION_WORK_MEM || AGGREGATION_WORK_MEM_DEFAULT;

  // set_config binds the value, so an operator-supplied env string never reaches the
  // parser and a non-numeric timeout cannot abort the transaction as 'NaN'.
  await manager.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(timeoutMs)]);
  // Keeps ~20k percentile_agg sketches in a HashAggregate; spilling turns the
  // aggregation into a GroupAggregate that sorts every input row to disk.
  await manager.query('SELECT set_config($1, $2, true)', ['work_mem', workMem]);
}

/** One statement (or a few) in its own transaction under the aggregation budget. */
export async function withAggregationBudget<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>
): Promise<T> {
  return dataSource.transaction(async (em) => {
    await applyAggregationBudget(em);
    return fn(em);
  });
}
