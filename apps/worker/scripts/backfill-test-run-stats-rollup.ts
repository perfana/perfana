/**
 * Backfill per-test-run transaction/sampler stats rollup (#150, #151).
 *
 * Enqueues `transaction-stats-rollup` jobs for every completed test run that
 * is missing rollup rows in `test_run_transaction_stats` OR in
 * `test_run_sampler_stats`. Both halves are checked because they read
 * different source tables (`transactions` vs `requests_raw`) and can disagree:
 * when the stage runs before request ingestion has finished, the transaction
 * half writes rows and the sampler half writes none. A transaction-only
 * predicate skips exactly those runs — and they are the ones that need it, as
 * every transaction row-expand then falls to the much slower CAGG path. Each
 * job is processed by the worker's standard pipeline path, so behavior is
 * identical to the in-line stage that runs at test-run finalization.
 *
 * Usage (from repo root):
 *   npx tsx apps/worker/scripts/backfill-test-run-stats-rollup.ts           # default: batch=50, poll=10s
 *   npx tsx apps/worker/scripts/backfill-test-run-stats-rollup.ts --dry-run # print plan, don't enqueue
 *   BATCH_SIZE=100 POLL_INTERVAL_MS=5000 npx tsx ... rollup.ts               # tuning knobs
 *
 * Safety:
 *   - Resumable: re-running the script picks up where it left off (it skips
 *     test_run_ids that already have rows).
 *   - Terminating: the loop exits when a poll returns no ids it has not already
 *     served this invocation, NOT when a poll returns nothing. A run with no
 *     usable `requests_raw` rows can never gain sampler rows, so it stays a
 *     candidate forever; without the per-invocation exclusion set such runs
 *     would pin the head of `ORDER BY end_time DESC LIMIT $1` and the script
 *     would spin on the same page indefinitely. Re-running the script later
 *     will offer those runs once more, which is the intended behaviour — one
 *     wasted no-op job per invocation, not an endless stream.
 *   - Rate-limited: only enqueues `batchSize` jobs per poll, waits for the
 *     queue to drain below a threshold before enqueuing more.
 *   - Idempotent: the pipeline's ON CONFLICT DO UPDATE makes re-running a
 *     per-test-run job safe (it refreshes the rollup rather than duplicating).
 */

import { DataSource } from 'typeorm';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.join(process.cwd(), '../.env.local') });

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10);
// Soft ceiling on the number of queued rollup jobs waiting for processing.
// Prevents flooding the queue and starving the analyze-test worker pool.
const MAX_INFLIGHT = parseInt(process.env.MAX_INFLIGHT || '200', 10);
const QUEUE_NAME = 'perfana-analyze';
const DRY_RUN = process.argv.includes('--dry-run');

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function countPending(queue: Queue): Promise<number> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
  return (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
}

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'perfana',
    synchronize: false,
    logging: false,
  });

  console.log('🔗 Connecting to database...');
  await dataSource.initialize();

  const redisConn = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  const queue = new Queue(QUEUE_NAME, { connection: redisConn });
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redisConn.duplicate() });
  await queueEvents.waitUntilReady();

  try {
    const [{ total }] = await dataSource.query<{ total: string }[]>(
      `SELECT COUNT(*)::text AS total
         FROM test_runs tr
        WHERE tr.completed = true
          AND NOT EXISTS (
            SELECT 1 FROM test_run_transaction_stats trs
             WHERE trs.test_run_id = tr.test_run_id
               AND EXISTS (
                 SELECT 1 FROM test_run_sampler_stats trss
                  WHERE trss.test_run_id = tr.test_run_id
               )
          )`,
    );
    const totalCount = parseInt(total, 10);

    console.log(`\n📊 Backfill candidates: ${totalCount} completed test run(s) missing rollup rows`);
    console.log(`   Batch size: ${BATCH_SIZE}, poll interval: ${POLL_INTERVAL_MS}ms, max inflight: ${MAX_INFLIGHT}`);
    console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no jobs enqueued)' : 'LIVE'}`);

    if (totalCount === 0) {
      console.log('✅ Nothing to backfill. Exiting.');
      return;
    }

    let enqueued = 0;
    let skippedAlreadyQueued = 0;
    // Every id this invocation has already served, excluded from later batches.
    //
    // The loop's exit is "a poll returned no NEW ids", not "a poll returned no
    // ids", and it has to be: a run whose `requests_raw` holds nothing the
    // rollup will aggregate never gains `test_run_sampler_stats` rows, so it
    // stays in the candidate set permanently. With an unfiltered
    // `ORDER BY end_time DESC LIMIT 50`, as few as BATCH_SIZE such runs pin the
    // head of the ordering: the loop would re-serve the same page every
    // POLL_INTERVAL_MS forever, never reaching older runs and never exiting.
    // The `queue.getJob` dedupe below does not save it either — that record only
    // survives while `removeOnComplete: 50` retains it on the shared queue, so
    // unrelated job volume eventually evicts it and the same 50 get re-enqueued.
    //
    // Ceiling, accepted: `seen` is re-sent in full on every poll and grows to
    // the number of runs served, so a backfill over tens of thousands of runs
    // degrades roughly quadratically toward the end. Fine for a manual operator
    // tool run occasionally; if it ever needs to scale, replace the exclusion
    // array with a keyset cursor on (end_time, created_at).
    const seen = new Set<string>();

    while (true) {
      const inflight = await countPending(queue);
      if (inflight >= MAX_INFLIGHT) {
        console.log(`⏸  Queue backlog at ${inflight}/${MAX_INFLIGHT}, waiting...`);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Pull the next batch of completed runs without rollup rows. We
      // re-query each iteration so runs that get rolled up mid-backfill
      // (including the ones we just enqueued) drop out naturally.
      const batch = await dataSource.query<{ test_run_id: string }[]>(
        `SELECT tr.test_run_id
           FROM test_runs tr
          WHERE tr.completed = true
            AND NOT EXISTS (
              SELECT 1 FROM test_run_transaction_stats trs
               WHERE trs.test_run_id = tr.test_run_id
                 AND EXISTS (
                   SELECT 1 FROM test_run_sampler_stats trss
                    WHERE trss.test_run_id = tr.test_run_id
                 )
            )
            AND tr.test_run_id <> ALL($2::text[])
          ORDER BY tr.end_time DESC NULLS LAST, tr.created_at DESC
          LIMIT $1`,
        [BATCH_SIZE, Array.from(seen)],
      );

      if (batch.length === 0) {
        console.log(`\n✅ No more test runs to process. Done.`);
        break;
      }

      for (const { test_run_id } of batch) {
        seen.add(test_run_id);
        const jobId = `rollup-backfill-${test_run_id}`;

        if (DRY_RUN) {
          console.log(`  [dry-run] would enqueue: ${jobId}`);
          continue;
        }

        // Dedupe: skip if a job with this jobId is already queued/active
        const existing = await queue.getJob(jobId);
        if (existing) {
          skippedAlreadyQueued++;
          continue;
        }

        await queue.add(
          'transaction-stats-rollup',
          { testRunId: test_run_id, initiatedBy: 'backfill', timestamp: new Date().toISOString() },
          {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 50,
            removeOnFail: 15,
          },
        );
        enqueued++;
      }

      console.log(
        `   enqueued=${enqueued}, skipped (already queued)=${skippedAlreadyQueued}, inflight=${await countPending(queue)}`,
      );

      if (DRY_RUN) {
        console.log(`\n✅ Dry run complete — would enqueue ${batch.length} jobs (truncated, re-run without --dry-run).`);
        break;
      }

      // Don't hammer the DB or the queue — one batch per poll interval.
      await sleep(POLL_INTERVAL_MS);
    }

    console.log(`\n📦 Enqueued ${enqueued} rollup jobs (${skippedAlreadyQueued} duplicates skipped).`);
    console.log(`   Monitor progress: SELECT COUNT(*) FROM test_run_transaction_stats;`);
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await queueEvents.close();
    await queue.close();
    redisConn.disconnect();
    await dataSource.destroy();
  }
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
