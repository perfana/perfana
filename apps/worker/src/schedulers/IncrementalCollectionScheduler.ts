import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { getDatabaseService } from '../common/database-accessor.js';
import { WorkerDatabaseService } from '../common/database.service.js';
import { getIncrementalCollectionConfig } from '../config/incremental-collection.config.js';
import { createSimpleQueue } from '../workers/simple-worker-factory.js';
import { SIMPLE_QUEUES } from '../config/simple-queues.js';
import { getConfig } from '../config/environment.js';
import { JOB_NAMES } from '../types/jobs.js';
import { TestRun, ApplicationDashboard } from '@perfana/shared/entities';
import { LessThan as _LessThan, MoreThan } from 'typeorm';

/**
 * Incremental Collection Scheduler
 *
 * Runs every minute to find in-progress test runs and enqueue incremental collection jobs.
 * This enables real-time metrics visibility during test execution without waiting for completion.
 *
 * Architecture:
 *   1. Query for test runs with recent heartbeat (endTime updated within threshold)
 *   2. For each in-progress test run:
 *      - Get associated ApplicationDashboards
 *      - Group dashboards by source (Grafana instance, Dynatrace config, performance test)
 *      - Enqueue `collect-metrics-incremental` jobs for each unique source
 *
 * Job Payload:
 *   - testRunId: string
 *   - sourceType: 'grafana' | 'dynatrace' | 'performance_test'
 *   - sourceId: string | null (Grafana instance ID, Dynatrace config ID, or null for perf test)
 *   - applicationDashboardIds: string[]
 *   - fromTime: ISO datetime (last collected time or test start)
 *   - toTime: ISO datetime (now)
 *   - attempt: number (1 initially)
 *   - maxAttempts: number (from config)
 */
/** Maximum backoff delay in milliseconds (10 minutes) */
const MAX_BACKOFF_MS = 600_000;

/** Base backoff delay in milliseconds (1 minute — matches cron interval) */
const BASE_BACKOFF_MS = 60_000;

/** Failure count at which we log an error-level warning */
const FAILURE_WARN_THRESHOLD = 3;

/** Failure count at which we stop retrying until the test run completes */
const FAILURE_STOP_THRESHOLD = 5;

@Injectable()
export class IncrementalCollectionScheduler {
  private readonly logger = new Logger(IncrementalCollectionScheduler.name);
  private analyzeQueue: Queue | null = null;
  private queueEvents: QueueEvents | null = null;
  private isRunning = false;
  private databaseService: WorkerDatabaseService | null = null;

  /**
   * Tracks consecutive failure counts per source.
   * Key format: `${testRunId}::${sourceType}::${sourceId}`
   */
  private failureCounts = new Map<string, number>();

  /**
   * Tracks the timestamp of the last failure for backoff calculation.
   * Key format: `${testRunId}::${sourceType}::${sourceId}`
   */
  private lastFailureTime = new Map<string, number>();

  /**
   * Maps BullMQ job IDs to source keys so we can update failure tracking on completion/failure.
   */
  private jobIdToSourceKey = new Map<string, string>();

  /**
   * Tracks which sources have an in-flight (pending or active) job.
   * Prevents enqueuing redundant jobs when the previous one hasn't completed yet.
   * Without this, each scheduler tick re-enqueues with fromTime=testStart because
   * getLastCollectedTime() returns null until the worker commits — causing O(n²)
   * redundant data fetches that grow with test duration.
   *
   * See: 2026-03-26 write starvation post-mortem
   */
  private inFlightJobs = new Set<string>();

  constructor() {
    this.logger.log('IncrementalCollectionScheduler initialized');
  }

  /**
   * Build a source key for failure tracking.
   */
  private buildSourceKey(testRunId: string, sourceType: string, sourceId: string | null): string {
    return `${testRunId}::${sourceType}::${sourceId ?? 'null'}`;
  }

  /**
   * Check if a source should be skipped due to backoff.
   * Returns true if the source is in backoff and should NOT be enqueued.
   */
  private shouldSkipDueToBackoff(sourceKey: string): boolean {
    const failureCount = this.failureCounts.get(sourceKey) ?? 0;
    if (failureCount === 0) { return false; }

    // Stop retrying entirely after persistent failures
    if (failureCount >= FAILURE_STOP_THRESHOLD) {
      return true;
    }

    // Check if enough time has passed since the last failure
    const lastFailure = this.lastFailureTime.get(sourceKey);
    if (!lastFailure) { return false; }

    const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, failureCount), MAX_BACKOFF_MS);
    const elapsed = Date.now() - lastFailure;

    if (elapsed < backoffMs) {
      this.logger.debug(
        `Skipping ${sourceKey} due to backoff (failures: ${failureCount}, ` +
        `backoff: ${Math.round(backoffMs / 1000)}s, elapsed: ${Math.round(elapsed / 1000)}s)`
      );
      return true;
    }

    return false;
  }

  /**
   * Record a failure for a source and log escalations.
   */
  private recordFailure(sourceKey: string): void {
    const count = (this.failureCounts.get(sourceKey) ?? 0) + 1;
    this.failureCounts.set(sourceKey, count);
    this.lastFailureTime.set(sourceKey, Date.now());

    if (count === FAILURE_WARN_THRESHOLD) {
      this.logger.error(
        `Incremental collection for ${sourceKey} has failed ${count} consecutive times. Consider manual re-fetch.`
      );
    } else if (count === FAILURE_STOP_THRESHOLD) {
      this.logger.error(
        `Incremental collection for ${sourceKey} persistently failing — stopping retries until test run completes.`
      );
    }
  }

  /**
   * Record a success for a source — resets failure tracking.
   */
  private recordSuccess(sourceKey: string): void {
    if (this.failureCounts.has(sourceKey)) {
      const previousCount = this.failureCounts.get(sourceKey) ?? 0;
      if (previousCount > 0) {
        this.logger.log(`Incremental collection for ${sourceKey} recovered after ${previousCount} failure(s)`);
      }
      this.failureCounts.delete(sourceKey);
      this.lastFailureTime.delete(sourceKey);
    }
  }

  /**
   * Clean up failure tracking for a specific test run (e.g., when the test run completes).
   */
  cleanupTestRun(testRunId: string): void {
    const prefix = `${testRunId}::`;
    for (const key of this.failureCounts.keys()) {
      if (key.startsWith(prefix)) {
        this.failureCounts.delete(key);
        this.lastFailureTime.delete(key);
      }
    }
    // Clean up in-flight tracking for this test run
    for (const key of this.inFlightJobs.keys()) {
      if (key.startsWith(prefix)) {
        this.inFlightJobs.delete(key);
      }
    }
    // Clean up job ID mappings for this test run
    for (const [jobId, sourceKey] of this.jobIdToSourceKey.entries()) {
      if (sourceKey.startsWith(prefix)) {
        this.jobIdToSourceKey.delete(jobId);
      }
    }
  }

  /**
   * Get database service lazily (NestJS context must be ready)
   */
  private getDb(): WorkerDatabaseService | null {
    if (!this.databaseService) {
      try {
        this.databaseService = getDatabaseService();
      } catch {
        // Context not ready yet
        return null;
      }
    }
    return this.databaseService;
  }

  /**
   * Initialize the queue connection and QueueEvents listener.
   * Called lazily on first cron execution.
   */
  private ensureQueueInitialized(): Queue {
    if (!this.analyzeQueue) {
      this.analyzeQueue = createSimpleQueue(SIMPLE_QUEUES.ANALYZE);
      this.logger.log('Initialized queue for incremental collection');
    }

    if (!this.queueEvents) {
      const config = getConfig();
      const connection = new IORedis({
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        password: config.REDIS_PASSWORD || undefined,
        db: config.REDIS_DB,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

      this.queueEvents = new QueueEvents(SIMPLE_QUEUES.ANALYZE, {
        connection,
        prefix: 'bull',
      });

      this.queueEvents.on('completed', ({ jobId }) => {
        const sourceKey = this.jobIdToSourceKey.get(jobId);
        if (sourceKey) {
          this.recordSuccess(sourceKey);
          this.inFlightJobs.delete(sourceKey);
          this.jobIdToSourceKey.delete(jobId);
        }
      });

      this.queueEvents.on('failed', ({ jobId }) => {
        const sourceKey = this.jobIdToSourceKey.get(jobId);
        if (sourceKey) {
          this.recordFailure(sourceKey);
          this.inFlightJobs.delete(sourceKey);
          this.jobIdToSourceKey.delete(jobId);
        }
      });

      this.logger.log('Initialized QueueEvents for failure tracking');
    }

    return this.analyzeQueue;
  }

  /**
   * Scheduled task that runs every minute
   * Finds in-progress test runs and enqueues incremental collection jobs
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    // Get database service (lazy init)
    const db = this.getDb();
    if (!db) {
      this.logger.debug('Database service not ready yet, skipping...');
      return;
    }

    // Prevent overlapping executions
    if (this.isRunning) {
      this.logger.warn('Previous incremental collection check still running, skipping...');
      return;
    }

    const config = getIncrementalCollectionConfig();

    // Check if feature is enabled
    if (!config.enabled) {
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('Starting incremental collection check...');

      // Find in-progress test runs
      const inProgressTestRuns = await this.findInProgressTestRuns(config.heartbeatThresholdSeconds);

      if (inProgressTestRuns.length === 0) {
        this.logger.log('No in-progress test runs found');
        return;
      }

      this.logger.log(`Found ${inProgressTestRuns.length} in-progress test run(s)`);

      // Enqueue collection jobs for each test run
      for (const testRun of inProgressTestRuns) {
        await this.enqueueCollectionJobs(testRun, config.maxRetries);
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Incremental collection check completed in ${duration}ms`);
    } catch (error) {
      this.logger.error(
        `Incremental collection check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Find test runs that are currently in progress
   * A test run is "in progress" if its endTime was updated within the heartbeat threshold
   *
   * @param heartbeatThresholdSeconds - Number of seconds to look back for endTime updates
   * @returns Array of in-progress test runs
   */
  private async findInProgressTestRuns(heartbeatThresholdSeconds: number): Promise<TestRun[]> {
    const heartbeatCutoff = new Date(Date.now() - heartbeatThresholdSeconds * 1000);

    if (!this.databaseService) {
      this.logger.error('Database service is not available');
      return [];
    }

    try {
      // Query for test runs where:
      // 1. endTime is within the heartbeat threshold (recently updated)
      // 2. completed is false (analysis hasn't started or finished)
      // 3. NOT stale
      const testRuns = await this.databaseService.testRunRepo.find({
        where: {
          endTime: MoreThan(heartbeatCutoff),
          completed: false,
          isStale: false,
        },
        order: {
          endTime: 'DESC',
        },
      });

      this.logger.debug(
        `Query found ${testRuns.length} test runs with endTime > ${heartbeatCutoff.toISOString()}`
      );

      return testRuns;
    } catch (error) {
      this.logger.error(
        `Failed to find in-progress test runs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
      return [];
    }
  }

  /**
   * Enqueue incremental collection jobs for a test run
   * Creates jobs for: Grafana sources, Dynatrace sources, and performance test metrics
   *
   * @param testRun - The test run to collect metrics for
   * @param maxAttempts - Maximum number of retry attempts
   */
  private async enqueueCollectionJobs(testRun: TestRun, maxAttempts: number): Promise<void> {
    if (!this.databaseService) {
      this.logger.error('Database service is not available');
      return;
    }

    try {
      // Default time range: test start to now
      const testStartTime = testRun.startTime || testRun.createdAt;
      const toTime = new Date();

      // Ensure queue is initialized
      const queue = this.ensureQueueInitialized();
      let jobsEnqueued = 0;

      // 1. Get ApplicationDashboards for Grafana sources
      const applicationDashboards = await this.databaseService.applicationDashboardRepo.find({
        where: {
          systemUnderTestId: testRun.systemUnderTestId,
          testEnvironment: testRun.testEnvironment,
        },
        relations: ['grafanaInstance'],
      });

      // Group Grafana dashboards by instance
      const grafanaGroups = this.groupDashboardsBySource(applicationDashboards);

      for (const [sourceKey, dashboards] of grafanaGroups.entries()) {
        const { sourceType, sourceId } = this.parseSourceKey(sourceKey);
        const failureKey = this.buildSourceKey(testRun.testRunId, sourceType, sourceId);

        // Check backoff before enqueuing
        if (this.shouldSkipDueToBackoff(failureKey)) {
          continue;
        }

        // Skip if a previous job for this source is still in-flight.
        // Without this, each tick re-enqueues with fromTime=testStart because
        // getLastCollectedTime() returns null until the worker commits.
        if (this.inFlightJobs.has(failureKey)) {
          this.logger.debug(
            `Skipping ${sourceType}/${sourceId || 'null'} — previous job still in-flight`
          );
          continue;
        }

        // Get last collected time for this source (for true incremental collection).
        // Falls back to in-memory toTime from the last enqueued job if DB hasn't been
        // updated yet (worker still processing), then to testStartTime (first collection).
        const lastCollectedTime = await this.databaseService.getLastCollectedTime(
          testRun.testRunId,
          sourceType,
          sourceId
        );
        const fromTime = lastCollectedTime || testStartTime;

        const jobPayload = {
          testRunId: testRun.testRunId,
          sourceType,
          sourceId,
          applicationDashboardIds: dashboards.map(d => d.id),
          fromTime: fromTime.toISOString(),
          toTime: toTime.toISOString(),
          attempt: 1,
          maxAttempts,
        };

        const job = await queue.add(JOB_NAMES.INCREMENTAL_COLLECTION, jobPayload, {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 25,
        });

        // Track job ID for failure/success callbacks and in-flight dedup
        if (job.id) {
          this.jobIdToSourceKey.set(job.id, failureKey);
          this.inFlightJobs.add(failureKey);
        }

        jobsEnqueued++;
        this.logger.debug(
          `Enqueued Grafana incremental collection job for test run ${testRun.testRunId}, ` +
          `source: ${sourceType}/${sourceId || 'null'}, dashboards: ${dashboards.length}, ` +
          `range: ${fromTime.toISOString()} to ${toTime.toISOString()}`
        );
      }

      // 2. Get unique Dynatrace configs for this test run
      const dynatraceConfigs = await this.databaseService.dataSource.query(`
        SELECT DISTINCT dq.dynatrace_config_id
        FROM dynatrace_queries dq
        WHERE dq.system_under_test_id = $1
          AND dq.test_environment = $2
          AND dq.workload = $3
          AND dq.dynatrace_config_id IS NOT NULL
      `, [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload]);

      for (const row of dynatraceConfigs) {
        const dtFailureKey = this.buildSourceKey(testRun.testRunId, 'dynatrace', row.dynatrace_config_id);

        // Check backoff before enqueuing
        if (this.shouldSkipDueToBackoff(dtFailureKey)) {
          continue;
        }

        // Skip if previous job still in-flight
        if (this.inFlightJobs.has(dtFailureKey)) {
          this.logger.debug(
            `Skipping dynatrace/${row.dynatrace_config_id} — previous job still in-flight`
          );
          continue;
        }

        // Get last collected time for this Dynatrace source
        const lastCollectedTime = await this.databaseService.getLastCollectedTime(
          testRun.testRunId,
          'dynatrace',
          row.dynatrace_config_id
        );
        const fromTime = lastCollectedTime || testStartTime;

        const jobPayload = {
          testRunId: testRun.testRunId,
          sourceType: 'dynatrace',
          sourceId: row.dynatrace_config_id,
          applicationDashboardIds: [],
          fromTime: fromTime.toISOString(),
          toTime: toTime.toISOString(),
          attempt: 1,
          maxAttempts,
        };

        const job = await queue.add(JOB_NAMES.INCREMENTAL_COLLECTION, jobPayload, {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 25,
        });

        // Track job ID for failure/success callbacks and in-flight dedup
        if (job.id) {
          this.jobIdToSourceKey.set(job.id, dtFailureKey);
          this.inFlightJobs.add(dtFailureKey);
        }

        jobsEnqueued++;
        this.logger.debug(
          `Enqueued Dynatrace incremental collection job for test run ${testRun.testRunId}, ` +
          `dynatraceConfigId: ${row.dynatrace_config_id}, ` +
          `range: ${fromTime.toISOString()} to ${toTime.toISOString()}`
        );
      }

      // 3. Enqueue a performance test metrics job (with backoff check)
      const perfTestFailureKey = this.buildSourceKey(testRun.testRunId, 'performance_test', null);

      if (!this.shouldSkipDueToBackoff(perfTestFailureKey) && !this.inFlightJobs.has(perfTestFailureKey)) {
        // Get last collected time for performance test source
        const perfTestLastCollected = await this.databaseService.getLastCollectedTime(
          testRun.testRunId,
          'performance_test',
          null
        );
        const perfTestFromTime = perfTestLastCollected || testStartTime;

        const perfTestPayload = {
          testRunId: testRun.testRunId,
          sourceType: 'performance_test',
          sourceId: null,
          applicationDashboardIds: [],
          fromTime: perfTestFromTime.toISOString(),
          toTime: toTime.toISOString(),
          attempt: 1,
          maxAttempts,
        };

        const perfJob = await queue.add(JOB_NAMES.INCREMENTAL_COLLECTION, perfTestPayload, {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 25,
        });

        // Track job ID for failure/success callbacks and in-flight dedup
        if (perfJob.id) {
          this.jobIdToSourceKey.set(perfJob.id, perfTestFailureKey);
          this.inFlightJobs.add(perfTestFailureKey);
        }

        jobsEnqueued++;
        this.logger.debug(
          `Enqueued performance test incremental collection job for test run ${testRun.testRunId}, ` +
          `range: ${perfTestFromTime.toISOString()} to ${toTime.toISOString()}`
        );
      }

      this.logger.log(
        `Enqueued ${jobsEnqueued} incremental collection job(s) for test run ${testRun.testRunId} ` +
        `(Grafana: ${grafanaGroups.size}, Dynatrace: ${dynatraceConfigs.length}, PerfTest: 1)`
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue collection jobs for test run ${testRun.testRunId}: ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Group ApplicationDashboards by their source (Grafana instance, Dynatrace config, performance test)
   *
   * @param dashboards - Array of ApplicationDashboards
   * @returns Map of source key to dashboards
   */
  private groupDashboardsBySource(
    dashboards: ApplicationDashboard[]
  ): Map<string, ApplicationDashboard[]> {
    const groups = new Map<string, ApplicationDashboard[]>();

    for (const dashboard of dashboards) {
      // Determine source type and ID
      let sourceKey: string;

      if (dashboard.grafanaInstanceId) {
        // Grafana source
        sourceKey = `grafana:${dashboard.grafanaInstanceId}`;
      } else {
        // TODO: Add Dynatrace support when DynatraceConfig relation is added to ApplicationDashboard
        // For now, skip non-Grafana dashboards
        this.logger.warn(
          `Dashboard ${dashboard.id} has no grafanaInstanceId - skipping for now (Dynatrace not yet supported)`
        );
        continue;
      }

      // Add to group
      if (!groups.has(sourceKey)) {
        groups.set(sourceKey, []);
      }
      groups.get(sourceKey)!.push(dashboard);
    }

    return groups;
  }

  /**
   * Parse source key into sourceType and sourceId
   *
   * @param sourceKey - Source key in format "type:id" or "type:null"
   * @returns Object with sourceType and sourceId
   */
  private parseSourceKey(sourceKey: string): { sourceType: string; sourceId: string | null } {
    const [sourceType, sourceId] = sourceKey.split(':');

    return {
      sourceType,
      sourceId: sourceId === 'null' ? null : sourceId,
    };
  }

  /**
   * Cleanup method called on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    if (this.queueEvents) {
      await this.queueEvents.close();
      this.logger.log('Closed QueueEvents connection');
    }
    if (this.analyzeQueue) {
      await this.analyzeQueue.close();
      this.logger.log('Closed queue connection');
    }
  }
}
