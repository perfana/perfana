import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { getDatabaseService } from '../common/database-accessor.js';
import { WorkerDatabaseService } from '../common/database.service.js';
import { getIncrementalCollectionConfig } from '../config/incremental-collection.config.js';
import { createSimpleQueue } from '../workers/simple-worker-factory.js';
import { SIMPLE_QUEUES } from '../config/simple-queues.js';
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
@Injectable()
export class IncrementalCollectionScheduler {
  private readonly logger = new Logger(IncrementalCollectionScheduler.name);
  private analyzeQueue: Queue | null = null;
  private isRunning = false;
  private databaseService: WorkerDatabaseService | null = null;

  constructor() {
    this.logger.log('IncrementalCollectionScheduler initialized');
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
   * Initialize the queue connection
   * Called lazily on first cron execution
   */
  private ensureQueueInitialized(): Queue {
    if (!this.analyzeQueue) {
      this.analyzeQueue = createSimpleQueue(SIMPLE_QUEUES.ANALYZE);
      this.logger.log('Initialized queue for incremental collection');
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

        // Get last collected time for this source (for true incremental collection)
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

        await queue.add(JOB_NAMES.INCREMENTAL_COLLECTION, jobPayload, {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 25,
        });

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

        await queue.add(JOB_NAMES.INCREMENTAL_COLLECTION, jobPayload, {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 25,
        });

        jobsEnqueued++;
        this.logger.debug(
          `Enqueued Dynatrace incremental collection job for test run ${testRun.testRunId}, ` +
          `dynatraceConfigId: ${row.dynatrace_config_id}, ` +
          `range: ${fromTime.toISOString()} to ${toTime.toISOString()}`
        );
      }

      // 3. Always enqueue a performance test metrics job
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

      await queue.add(JOB_NAMES.INCREMENTAL_COLLECTION, perfTestPayload, {
        attempts: maxAttempts,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 25,
      });

      jobsEnqueued++;
      this.logger.debug(
        `Enqueued performance test incremental collection job for test run ${testRun.testRunId}, ` +
        `range: ${perfTestFromTime.toISOString()} to ${toTime.toISOString()}`
      );

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
    if (this.analyzeQueue) {
      await this.analyzeQueue.close();
      this.logger.log('Closed queue connection');
    }
  }
}
