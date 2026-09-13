import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { getLogger } from '../lib/utils/logger.js';
import { JOB_NAMES } from '../types/jobs.js';

const logger = getLogger('heavy-stage-mutex');

/** Redis key: one holder per deployment. */
export const HEAVY_STAGE_LOCK_KEY = 'job:heavy-stage-lock';

/**
 * The analyze stages that run a multi-minute aggregation over ds_metrics. Two of these on
 * the same Postgres at once evict each other's pages and spill each other's sorts
 * (2026-09-11: 16% cache hit ratio, 90 MB/s temp files, 3 of 4 parallel analyses failed),
 * so they run one at a time. Everything else in the pipeline is cheap enough to overlap.
 */
export const HEAVY_STAGES: ReadonlySet<string> = new Set([
  // The registry job names ARE the orchestrator stage names (PipelineOrchestrator.ts
  // ORCHESTRATED_STAGES); sourcing them from JOB_NAMES keeps a rename from silently
  // running a stage unguarded and with the wall-clock race restored.
  JOB_NAMES.STATISTICS_PIPELINE,
  JOB_NAMES.CONTROL_GROUP_STATISTICS,
  JOB_NAMES.ADAPT_PIPELINE,
  // Rebuilds a run's ds_metrics from requests_raw (PERCENTILE_CONT grouping sets) and then
  // percentile_agg's the whole run for ds_metric_statistics — the same shape as
  // statistics-calculation. Unguarded, two of these beside a heavy stage pushed one past the
  // 600 s wall clock and its job was recorded completed with the analysis dropped.
  // Covers the analyze-time stage only: the live per-minute tick runs the same pipeline
  // through incremental-metrics and must not queue behind a multi-minute stage.
  // ponytail: this stage is several main-pool statements (600 s each) plus JS, not one
  // statement_timeout-bounded transaction, so its worst-case hold is longer than the other
  // three; waiters give up as RETRYABLE after HEAVY_STAGE_MAX_WAIT_MS. Give it a
  // setAggregationBudget transaction if that ceiling is ever reached.
  JOB_NAMES.PERFORMANCE_TEST_METRICS,
]);

const LOCK_TTL_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;
const DEFAULT_POLL_MS = 5_000;
/**
 * ponytail: 1h ceiling; a job that queues longer than that has a stuck holder, not a busy one.
 * Exported because the re-evaluate orchestrator's parked-time ceiling must be >= this: if the
 * parent gave up first it would remove a child that was about to fail with the better error.
 */
export const HEAVY_STAGE_MAX_WAIT_MS = 60 * 60_000;

// Compare-and-... so a job can only touch a lock it holds. A holder whose TTL lapsed
// (process died, heartbeat stopped) must not delete the next job's lock on its way out.
const PEXPIRE_IF_HOLDER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`;
const DEL_IF_HOLDER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/**
 * Deployment-wide mutex around the heavy analyze stages. `SET NX PX` + heartbeat, so a
 * dead holder frees the lock within LOCK_TTL_MS and a live one keeps it for as long as
 * its stage runs.
 *
 * ponytail: single global lock, not a counting semaphore. Make it a semaphore (INCR with a
 * cap) if one heavy stage at a time leaves the database idle.
 */
export class HeavyStageMutex {
  /**
   * What is stored in Redis: `<holder>|<nonce>`. The nonce is per acquire() call because a
   * BullMQ job id is NOT unique per acquisition — a stalled job re-dispatched to another
   * worker, or a retry attempt, carries the same id. With the bare id as the token, the
   * old instance's release would pass the compare-and-delete against the NEW instance's
   * lock and its heartbeat would keep extending a lock it no longer owns.
   */
  private token = '';

  constructor(
    private readonly redis: Redis,
    private readonly holder: string,
    private readonly opts: { pollMs?: number; maxWaitMs?: number } = {},
  ) {}

  /**
   * Block until the lock is ours. `onWaiting(currentHolder)` fires on every poll while
   * someone else holds it, so the caller can keep its progress record fresh — the record
   * expires after 5 min and the API evicts the job once it is gone.
   *
   * Resolves to the release function. Always call it in a `finally`.
   */
  async acquire(onWaiting?: (currentHolder: string) => Promise<void>): Promise<() => Promise<void>> {
    const pollMs = this.opts.pollMs ?? DEFAULT_POLL_MS;
    const maxWaitMs = this.opts.maxWaitMs ?? HEAVY_STAGE_MAX_WAIT_MS;
    const startedAt = Date.now();
    this.token = `${this.holder}|${randomUUID()}`;

    for (;;) {
      const ok = await this.redis.set(HEAVY_STAGE_LOCK_KEY, this.token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') {break;}

      const waited = Date.now() - startedAt;
      if (waited > maxWaitMs) {
        throw new Error(`Heavy-stage lock not acquired after ${Math.round(waited / 1000)}s (held by ${await this.currentHolder()})`);
      }
      await onWaiting?.(await this.currentHolder());
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const waitedMs = Date.now() - startedAt;
    if (waitedMs > pollMs) {logger.info(`Heavy-stage lock acquired by ${this.holder} after ${Math.round(waitedMs / 1000)}s`);}

    const heartbeat = setInterval(() => {
      this.redis.eval(PEXPIRE_IF_HOLDER, 1, HEAVY_STAGE_LOCK_KEY, this.token, LOCK_TTL_MS).then((extended) => {
        // 0 = the key is no longer ours (TTL lapsed under a Redis partition, someone else took
        // it). The aggregation cannot be cancelled mid-statement, but a repeat of the 16 %
        // cache-hit incident must be attributable to this.
        if (extended !== 1) {logger.error(`Heavy-stage lock lost by ${this.holder} while its stage is still running`);}
      }).catch((err) => {
        logger.warn(`Heavy-stage lock heartbeat failed for ${this.holder}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, HEARTBEAT_MS);

    return async () => {
      clearInterval(heartbeat);
      try {
        await this.redis.eval(DEL_IF_HOLDER, 1, HEAVY_STAGE_LOCK_KEY, this.token);
      } catch (err) {
        // The TTL frees it in ≤5 min either way; log so a run of "queued" jobs can be explained.
        logger.error(`Heavy-stage lock release failed for ${this.holder}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
  }

  /** The readable holder id (job id), without the per-acquisition nonce. */
  private async currentHolder(): Promise<string> {
    const value = await this.redis.get(HEAVY_STAGE_LOCK_KEY);
    return value?.split('|')[0] || 'unknown';
  }
}
