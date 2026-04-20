/**
 * Backfill per-test-run transaction/sampler stats rollup (#150, #151).
 *
 * Enqueues `transaction-stats-rollup` jobs for every completed test run that
 * does NOT already have rollup rows in `test_run_transaction_stats`. Each
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
            )
          ORDER BY tr.end_time DESC NULLS LAST, tr.created_at DESC
          LIMIT $1`,
        [BATCH_SIZE],
      );

      if (batch.length === 0) {
        console.log(`\n✅ No more test runs to process. Done.`);
        break;
      }

      for (const { test_run_id } of batch) {
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
