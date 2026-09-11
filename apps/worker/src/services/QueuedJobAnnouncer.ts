import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { In } from 'typeorm';
import { JOB_DEFAULTS, JOB_REDIS_CHANNELS, JOB_REDIS_KEYS, generateLockKey, type JobProgress } from '@perfana/shared/types';
import { getLogger } from '../lib/utils/logger.js';
import { getDatabaseService } from '../common/database-accessor.js';
import { JOB_NAMES } from '../types/jobs.js';

const logger = getLogger('queued-job-announcer');

const SCAN_INTERVAL_MS = 30_000;
/**
 * SETEX only when the key is absent or still a queued record. A job picked up between
 * getWaiting() and this write already has a live ProgressReporter record; overwriting
 * it would show "Queued" until the reporter's next publish.
 */
const SETEX_UNLESS_LIVE = `local v = redis.call('get', KEYS[1])
if v and not string.find(v, '"status":"waiting"', 1, true) then return 0 end
redis.call('setex', KEYS[1], ARGV[1], ARGV[2])
return 1`;
/** ponytail: a deployment with more than this many analyses waiting has a bigger problem than a missing badge. */
const MAX_WAITING_JOBS = 200;

/**
 * Publishes a `waiting` progress record for every analyze-test job still in BullMQ's
 * waiting list, so the UI can say "queued" before a worker has picked the job up.
 *
 * Nothing else can: ProgressReporter only exists once a processor runs, and the API's
 * enqueue path knows the testRunId but not the scope the UI subscribes by. Re-published
 * every 30 s because the API evicts a record whose lastProgressAt is older than 5 min
 * and the progress key itself expires on the same TTL — so a job that leaves the queue
 * without ever running (drained, removed) shows as queued for at most 5 min.
 *
 * Once the worker starts the job, its ProgressReporter overwrites the same key.
 *
 * ponytail: every worker replica runs one of these; with N replicas each waiting job is
 * published N times per 30 s. Add a leader key (SET NX PX) if that ever matters.
 */
export class QueuedJobAnnouncer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly redis: Redis,
    private readonly analyzeQueue: Queue,
  ) {}

  start(): void {
    if (this.timer) {return;}
    this.timer = setInterval(() => void this.announce(), SCAN_INTERVAL_MS);
    void this.announce();
    logger.info(`QueuedJobAnnouncer started (every ${SCAN_INTERVAL_MS / 1000}s)`);
  }

  async stop(): Promise<void> {
    if (this.timer) {clearInterval(this.timer);}
    this.timer = null;
    // The queue handle owns its own Redis connection (createSimpleQueue); close it or it
    // outlives the graceful shutdown that closes every other worker connection.
    await this.analyzeQueue.close();
  }

  async announce(): Promise<number> {
    if (this.running) {return 0;}
    this.running = true;
    try {
      const waiting = (await this.analyzeQueue.getWaiting(0, MAX_WAITING_JOBS - 1)).filter(
        (job) => job.name === JOB_NAMES.ANALYZE_TEST && typeof job.data?.testRunId === 'string',
      );
      if (waiting.length === 0) {return 0;}

      const runs = await getDatabaseService().testRunRepo.find({
        where: { testRunId: In(waiting.map((j) => j.data.testRunId as string)) },
        select: ['testRunId', 'systemUnderTestId', 'testEnvironment', 'workload'],
      });
      const byId = new Map(runs.map((r) => [r.testRunId, r]));

      const now = new Date().toISOString();
      let published = 0;
      for (const job of waiting) {
        const run = byId.get(job.data.testRunId as string);
        if (!run) {continue;}

        // Two runs of one workload finishing together is the normal case. The API keeps one
        // job per scope (last writer wins) and the web hook accepts any frame in its scope,
        // so announcing B while A is running would replace A's live frame with B's "Queued"
        // for the length of A's heavy stage. A holds the scope lock; B is re-parked on pickup
        // (analyze.ts, moveToDelayed) and gets announced once A releases it.
        const lock = await this.redis.get(generateLockKey(run.systemUnderTestId, run.testEnvironment, run.workload));
        if (lock && (JSON.parse(lock) as { jobId?: string }).jobId !== job.id) {continue;}

        const progress: JobProgress = {
          jobId: job.id!,
          testRunId: run.testRunId,
          systemUnderTestId: run.systemUnderTestId,
          testEnvironment: run.testEnvironment,
          workload: run.workload,
          jobType: 'analyze',
          stage: 'queued',
          stageName: 'Queued',
          stageIndex: 0,
          totalStages: 0,
          stageProgress: 0,
          overallProgress: 0,
          message: 'Queued: waiting for an analysis worker to become free',
          startedAt: new Date(job.timestamp).toISOString(),
          lastProgressAt: now,
          status: 'waiting',
        };

        const written = await this.redis.eval(
          SETEX_UNLESS_LIVE,
          1,
          `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${job.id}`,
          JOB_DEFAULTS.LOCK_TTL_SECONDS,
          JSON.stringify(progress),
        );
        if (written !== 1) {continue;}
        await this.redis.publish(JOB_REDIS_CHANNELS.PROGRESS, JSON.stringify({ type: 'job:progress', payload: progress }));
        published++;
      }
      return published;
    } catch (err) {
      logger.warn(`QueuedJobAnnouncer scan failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
