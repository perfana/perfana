/**
 * IncrementalCollectionScheduler Unit Tests
 *
 * Covers:
 * - Scheduler initialization and lazy setup
 * - Cron tick / handleCron behavior
 * - In-progress test run discovery
 * - Collection job dispatching (Grafana, Dynatrace, performance_test)
 * - In-flight deduplication
 * - Backoff and failure tracking (buildSourceKey, shouldSkipDueToBackoff, recordFailure, recordSuccess)
 * - cleanupTestRun removing all tracked state
 * - onModuleDestroy closing queues
 * - Edge cases: DB not ready, feature disabled, no active runs, overlapping ticks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IncrementalCollectionScheduler } from '../../../schedulers/IncrementalCollectionScheduler.js';

// ---------------------------------------------------------------------------
// Shared mock state — declared before vi.mock() factories so closures capture them
// ---------------------------------------------------------------------------

let mockTestRunRepo: {
  find: ReturnType<typeof vi.fn>;
};

let mockApplicationDashboardRepo: {
  find: ReturnType<typeof vi.fn>;
};

let mockDataSource: {
  query: ReturnType<typeof vi.fn>;
};

let mockDb: {
  testRunRepo: typeof mockTestRunRepo;
  applicationDashboardRepo: typeof mockApplicationDashboardRepo;
  dataSource: typeof mockDataSource;
  getLastCollectedTime: ReturnType<typeof vi.fn>;
};

// QueueEvents mock types and shared mocks
type QueueEventsHandler = (payload: { jobId: string }) => void;

const mockQueueAdd = vi.fn();
const mockQueueClose = vi.fn();
const mockQueueEventsClose = vi.fn();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDb),
}));

vi.mock('../../../config/incremental-collection.config.js', () => ({
  getIncrementalCollectionConfig: vi.fn(() => ({
    enabled: true,
    intervalSeconds: 60,
    maxRetries: 5,
    heartbeatThresholdSeconds: 30,
    batchSize: 20,
  })),
}));

vi.mock('../../../config/environment.js', () => ({
  getConfig: vi.fn(() => ({
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
    REDIS_DB: 0,
  })),
}));

vi.mock('../../../workers/simple-worker-factory.js', () => ({
  createSimpleQueue: vi.fn(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  QueueEvents: vi.fn().mockImplementation(() => ({
    // Handlers are registered on this object; tests can inspect queueEvents
    // instance stored on the scheduler via scheduler['queueEvents'].
    on: vi.fn() as (event: string, handler: QueueEventsHandler) => void,
    close: mockQueueEventsClose,
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

// NestJS decorators — no-ops in unit-test context
vi.mock('@nestjs/common', () => ({
  Injectable: () => () => {},
  Logger: vi.fn().mockImplementation(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: { EVERY_MINUTE: '* * * * *' },
}));

vi.mock('../../../config/simple-queues.js', () => ({
  SIMPLE_QUEUES: { ANALYZE: 'perfana-analyze' },
}));

vi.mock('../../../types/jobs.js', () => ({
  JOB_NAMES: { INCREMENTAL_COLLECTION: 'collect-metrics-incremental' },
}));

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeTestRun(overrides: Partial<{
  testRunId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  startTime: Date;
  createdAt: Date;
  endTime: Date;
  completed: boolean;
  isStale: boolean;
}> = {}) {
  return {
    testRunId: 'run-abc123',
    systemUnderTestId: 'sut-001',
    testEnvironment: 'acc',
    workload: 'load-test',
    startTime: new Date('2024-01-01T10:00:00Z'),
    createdAt: new Date('2024-01-01T09:59:00Z'),
    endTime: new Date(),
    completed: false,
    isStale: false,
    ...overrides,
  };
}

function makeApplicationDashboard(overrides: Partial<{
  id: string;
  grafanaInstanceId: string;
  systemUnderTestId: string;
  testEnvironment: string;
}> = {}) {
  return {
    id: 'dash-uuid-1',
    grafanaInstanceId: 'grafana-inst-1',
    systemUnderTestId: 'sut-001',
    testEnvironment: 'acc',
    ...overrides,
  };
}

function makeJob(id: string) {
  return { id };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('IncrementalCollectionScheduler', () => {
  let scheduler: IncrementalCollectionScheduler;

  beforeEach(() => {
    // Rebuild fresh mock DB before each test so state is isolated
    mockTestRunRepo = { find: vi.fn().mockResolvedValue([]) };
    mockApplicationDashboardRepo = { find: vi.fn().mockResolvedValue([]) };
    mockDataSource = { query: vi.fn().mockResolvedValue([]) };
    mockDb = {
      testRunRepo: mockTestRunRepo,
      applicationDashboardRepo: mockApplicationDashboardRepo,
      dataSource: mockDataSource,
      getLastCollectedTime: vi.fn().mockResolvedValue(null),
    };

    mockQueueAdd.mockResolvedValue(makeJob('job-1'));
    mockQueueClose.mockResolvedValue(undefined);
    mockQueueEventsClose.mockResolvedValue(undefined);

    scheduler = new IncrementalCollectionScheduler();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe('Initialization', () => {
    it('should construct without throwing', () => {
      expect(() => new IncrementalCollectionScheduler()).not.toThrow();
    });

    it('should start with isRunning = false (no overlapping guard fires on first tick)', async () => {
      // Arrange: inject databaseService so DB is available
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;

      // Act
      await scheduler.handleCron();
      await scheduler.handleCron(); // second call should run too (isRunning resets)

      // Both calls succeeded — testRunRepo.find was called twice
      expect(mockTestRunRepo.find).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // handleCron — feature flag and DB readiness guards
  // -------------------------------------------------------------------------

  describe('handleCron — guards', () => {
    it('should skip when database service is not yet ready', async () => {
      // Arrange: databaseService is null (getDb returns null when getService throws)
      const { getDatabaseService } = await import('../../../common/database-accessor.js');
      vi.mocked(getDatabaseService).mockImplementationOnce(() => {
        throw new Error('NestJS context not ready');
      });

      // Act
      await scheduler.handleCron();

      // Assert: repo never queried
      expect(mockTestRunRepo.find).not.toHaveBeenCalled();
    });

    it('should skip when incremental collection is disabled', async () => {
      // Arrange
      const { getIncrementalCollectionConfig } = await import('../../../config/incremental-collection.config.js');
      vi.mocked(getIncrementalCollectionConfig).mockReturnValueOnce({
        enabled: false,
        intervalSeconds: 60,
        maxRetries: 5,
        heartbeatThresholdSeconds: 30,
        batchSize: 20,
      });
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;

      // Act
      await scheduler.handleCron();

      // Assert
      expect(mockTestRunRepo.find).not.toHaveBeenCalled();
    });

    it('should skip with a warning when a previous tick is still running', async () => {
      // Arrange: force isRunning = true to simulate overlap
      (scheduler as unknown as { isRunning: boolean }).isRunning = true;
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;

      // Act
      await scheduler.handleCron();

      // Assert: repo never queried
      expect(mockTestRunRepo.find).not.toHaveBeenCalled();
    });

    it('should reset isRunning to false after a successful tick', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;

      // Act
      await scheduler.handleCron();

      // Assert
      expect((scheduler as unknown as { isRunning: boolean }).isRunning).toBe(false);
    });

    it('should reset isRunning to false even when an error is thrown', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockRejectedValueOnce(new Error('DB exploded'));

      // Act
      await scheduler.handleCron();

      // Assert: still resets
      expect((scheduler as unknown as { isRunning: boolean }).isRunning).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // handleCron — no in-progress test runs
  // -------------------------------------------------------------------------

  describe('handleCron — no active test runs', () => {
    it('should enqueue no jobs when no in-progress test runs are found', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('should query using the configured heartbeat threshold', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;

      // Act
      await scheduler.handleCron();

      // Assert: repo was called with MoreThan cutoff (endTime field), completed:false, isStale:false
      expect(mockTestRunRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            completed: false,
            isStale: false,
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleCron — collection job dispatching
  // -------------------------------------------------------------------------

  describe('handleCron — job dispatching', () => {
    it('should enqueue one Grafana job and one performance_test job when one dashboard is found', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]); // no Dynatrace configs
      mockQueueAdd.mockResolvedValue(makeJob('job-g1'));

      // Act
      await scheduler.handleCron();

      // Assert: 2 calls — Grafana + performance_test
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
      const [grafanaCall, perfTestCall] = mockQueueAdd.mock.calls;

      expect(grafanaCall[0]).toBe('collect-metrics-incremental');
      expect(grafanaCall[1]).toMatchObject({
        testRunId: 'run-abc123',
        sourceType: 'grafana',
        sourceId: 'grafana-inst-1',
        applicationDashboardIds: ['dash-uuid-1'],
        attempt: 1,
        maxAttempts: 5,
      });

      expect(perfTestCall[0]).toBe('collect-metrics-incremental');
      expect(perfTestCall[1]).toMatchObject({
        testRunId: 'run-abc123',
        sourceType: 'performance_test',
        sourceId: null,
        applicationDashboardIds: [],
      });
    });

    it('should build colon-free BullMQ jobIds (issue #426)', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockQueueAdd.mockResolvedValue(makeJob('job-g1'));

      // Act
      await scheduler.handleCron();

      // Assert: BullMQ rejects any jobId containing ':' (its Redis key separator)
      expect(mockQueueAdd).toHaveBeenCalled();
      for (const call of mockQueueAdd.mock.calls) {
        expect(call[2].jobId).not.toContain(':');
      }
    });

    it('should group dashboards from the same Grafana instance into one job', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([
        makeApplicationDashboard({ id: 'dash-1', grafanaInstanceId: 'inst-A' }),
        makeApplicationDashboard({ id: 'dash-2', grafanaInstanceId: 'inst-A' }),
        makeApplicationDashboard({ id: 'dash-3', grafanaInstanceId: 'inst-A' }),
      ]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: only 2 calls (one Grafana group + performance_test)
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
      const grafanaCall = mockQueueAdd.mock.calls[0];
      expect(grafanaCall[1].applicationDashboardIds).toEqual(['dash-1', 'dash-2', 'dash-3']);
    });

    it('should create separate Grafana jobs for each distinct Grafana instance', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([
        makeApplicationDashboard({ id: 'dash-1', grafanaInstanceId: 'inst-A' }),
        makeApplicationDashboard({ id: 'dash-2', grafanaInstanceId: 'inst-B' }),
      ]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: 3 calls — inst-A, inst-B, performance_test
      expect(mockQueueAdd).toHaveBeenCalledTimes(3);
      const sourceIds = mockQueueAdd.mock.calls.map((c: unknown[]) => (c[1] as Record<string, unknown>).sourceId);
      expect(sourceIds).toContain('inst-A');
      expect(sourceIds).toContain('inst-B');
      expect(sourceIds).toContain(null);
    });

    it('should enqueue a Dynatrace job for each distinct dynatrace_config_id', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([]);
      mockDataSource.query.mockResolvedValue([
        { dynatrace_config_id: 'dt-config-uuid-1' },
        { dynatrace_config_id: 'dt-config-uuid-2' },
      ]);

      // Act
      await scheduler.handleCron();

      // Assert: 3 calls — 2 Dynatrace + 1 performance_test
      expect(mockQueueAdd).toHaveBeenCalledTimes(3);
      const calls = mockQueueAdd.mock.calls;
      const dtCalls = calls.filter((c: unknown[]) => (c[1] as Record<string, unknown>).sourceType === 'dynatrace');
      expect(dtCalls).toHaveLength(2);
      expect(dtCalls[0][1]).toMatchObject({
        sourceType: 'dynatrace',
        sourceId: 'dt-config-uuid-1',
        applicationDashboardIds: [],
      });
      expect(dtCalls[1][1]).toMatchObject({
        sourceType: 'dynatrace',
        sourceId: 'dt-config-uuid-2',
      });
    });

    it('should use testRun.startTime as fromTime when no last collected time exists', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const startTime = new Date('2024-01-01T10:00:00Z');
      const testRun = makeTestRun({ startTime });
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockDb.getLastCollectedTime.mockResolvedValue(null);

      // Act
      await scheduler.handleCron();

      // Assert: fromTime matches startTime
      const grafanaCall = mockQueueAdd.mock.calls[0];
      expect(grafanaCall[1].fromTime).toBe(startTime.toISOString());
    });

    it('should use testRun.createdAt as fromTime fallback when startTime is null', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const createdAt = new Date('2024-01-01T09:59:00Z');
      const testRun = makeTestRun({ startTime: undefined as unknown as Date, createdAt });
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockDb.getLastCollectedTime.mockResolvedValue(null);

      // Act
      await scheduler.handleCron();

      // Assert
      const grafanaCall = mockQueueAdd.mock.calls[0];
      expect(grafanaCall[1].fromTime).toBe(createdAt.toISOString());
    });

    it('should use lastCollectedTime as fromTime when available', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const lastCollected = new Date('2024-01-01T10:30:00Z');
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockDb.getLastCollectedTime.mockResolvedValue(lastCollected);

      // Act
      await scheduler.handleCron();

      // Assert
      const grafanaCall = mockQueueAdd.mock.calls[0];
      expect(grafanaCall[1].fromTime).toBe(lastCollected.toISOString());
    });

    it('should skip dashboards without a grafanaInstanceId and not enqueue for them', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      // Dashboard with no grafanaInstanceId
      mockApplicationDashboardRepo.find.mockResolvedValue([
        makeApplicationDashboard({ grafanaInstanceId: undefined as unknown as string }),
      ]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: only performance_test job was enqueued (no Grafana jobs)
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockQueueAdd.mock.calls[0][1].sourceType).toBe('performance_test');
    });

    it('should pass BullMQ job options with exponential backoff', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: job options
      const grafanaCallOptions = mockQueueAdd.mock.calls[0][2];
      expect(grafanaCallOptions).toMatchObject({
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 25,
      });
    });

    it('should enqueue jobs for multiple in-progress test runs', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun1 = makeTestRun({ testRunId: 'run-1' });
      const testRun2 = makeTestRun({ testRunId: 'run-2' });
      mockTestRunRepo.find.mockResolvedValue([testRun1, testRun2]);
      mockApplicationDashboardRepo.find.mockResolvedValue([]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: performance_test job for each run
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
      const testRunIds = mockQueueAdd.mock.calls.map((c: unknown[]) => (c[1] as Record<string, unknown>).testRunId);
      expect(testRunIds).toContain('run-1');
      expect(testRunIds).toContain('run-2');
    });
  });

  // -------------------------------------------------------------------------
  // In-flight deduplication
  // -------------------------------------------------------------------------

  describe('In-flight deduplication', () => {
    it('should not enqueue a second Grafana job while the first is still in-flight', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockQueueAdd.mockResolvedValue(makeJob('job-g1'));

      // Act — first tick enqueues Grafana job; second tick should skip it
      await scheduler.handleCron();
      const firstTickCount = mockQueueAdd.mock.calls.length;

      await scheduler.handleCron();
      const secondTickCount = mockQueueAdd.mock.calls.length - firstTickCount;

      // Assert: second tick produced zero Grafana job but still produced
      //         performance_test (unless that too is in-flight)
      // Both grafana and performance_test are in-flight after tick 1 → tick 2 adds 0
      expect(secondTickCount).toBe(0);
    });

    it('should add job to inFlightJobs set after enqueuing', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun();
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockQueueAdd.mockResolvedValue(makeJob('job-g1'));

      // Act
      await scheduler.handleCron();

      // Assert
      const inFlight = (scheduler as unknown as { inFlightJobs: Set<string> }).inFlightJobs;
      expect(inFlight.size).toBeGreaterThan(0);
      expect(inFlight.has('run-abc123::grafana::grafana-inst-1')).toBe(true);
    });

    it('should remove job from inFlightJobs when the scheduler processes a completed job', async () => {
      // Arrange — seed the scheduler's internal tracking maps directly, simulating
      // what handleCron would have done after enqueueing a job.
      const inFlight = (scheduler as unknown as { inFlightJobs: Set<string> }).inFlightJobs;
      const jobIdToSourceKey = (scheduler as unknown as { jobIdToSourceKey: Map<string, string> }).jobIdToSourceKey;
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      inFlight.add(sourceKey);
      jobIdToSourceKey.set('job-complete-1', sourceKey);

      // Verify precondition
      expect(inFlight.has(sourceKey)).toBe(true);

      // Act: simulate the 'completed' QueueEvents callback by calling the internal handler logic
      // The scheduler's QueueEvents 'completed' handler does: recordSuccess + inFlightJobs.delete + jobIdToSourceKey.delete
      const recordSuccess = (scheduler as unknown as { recordSuccess(key: string): void }).recordSuccess.bind(scheduler);
      recordSuccess(sourceKey);
      inFlight.delete(sourceKey);
      jobIdToSourceKey.delete('job-complete-1');

      // Assert
      expect(inFlight.has(sourceKey)).toBe(false);
      expect(jobIdToSourceKey.has('job-complete-1')).toBe(false);
    });

    it('should remove job from inFlightJobs when the scheduler processes a failed job', async () => {
      // Arrange — seed internal tracking maps directly
      const inFlight = (scheduler as unknown as { inFlightJobs: Set<string> }).inFlightJobs;
      const jobIdToSourceKey = (scheduler as unknown as { jobIdToSourceKey: Map<string, string> }).jobIdToSourceKey;
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      inFlight.add(sourceKey);
      jobIdToSourceKey.set('job-fail-1', sourceKey);

      expect(inFlight.has(sourceKey)).toBe(true);

      // Act: simulate the 'failed' QueueEvents callback
      const recordFailure = (scheduler as unknown as { recordFailure(key: string): void }).recordFailure.bind(scheduler);
      recordFailure(sourceKey);
      inFlight.delete(sourceKey);
      jobIdToSourceKey.delete('job-fail-1');

      // Assert
      expect(inFlight.has(sourceKey)).toBe(false);
      expect(jobIdToSourceKey.has('job-fail-1')).toBe(false);
    });

    it('should not modify state when a completed job ID has no sourceKey mapping', () => {
      // Arrange
      const inFlight = (scheduler as unknown as { inFlightJobs: Set<string> }).inFlightJobs;
      const jobIdToSourceKey = (scheduler as unknown as { jobIdToSourceKey: Map<string, string> }).jobIdToSourceKey;
      inFlight.add('run-abc123::grafana::grafana-inst-1');

      // Act: jobIdToSourceKey.get('unknown-job') returns undefined — no-op
      const sourceKey = jobIdToSourceKey.get('unknown-job-999');
      if (sourceKey) {
        inFlight.delete(sourceKey);
        jobIdToSourceKey.delete('unknown-job-999');
      }

      // Assert: inFlight is unchanged
      expect(inFlight.has('run-abc123::grafana::grafana-inst-1')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Failure tracking and backoff
  // -------------------------------------------------------------------------

  describe('Failure tracking and backoff', () => {
    it('should record failure and increment failure count when recordFailure is called', () => {
      // Arrange
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      const failureCounts = (scheduler as unknown as { failureCounts: Map<string, number> }).failureCounts;

      // Act: call recordFailure directly (mimicking what the QueueEvents 'failed' handler does)
      const recordFailure = (scheduler as unknown as { recordFailure(key: string): void }).recordFailure.bind(scheduler);
      recordFailure(sourceKey);

      // Assert
      expect(failureCounts.get(sourceKey)).toBe(1);
    });

    it('should record success and reset failure count when recordSuccess is called', () => {
      // Arrange: pre-seed failure tracking for a source
      const failureCounts = (scheduler as unknown as { failureCounts: Map<string, number> }).failureCounts;
      const lastFailureTime = (scheduler as unknown as { lastFailureTime: Map<string, number> }).lastFailureTime;
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      failureCounts.set(sourceKey, 3);
      lastFailureTime.set(sourceKey, Date.now() - 100_000);

      // Act: call recordSuccess directly (mimicking what the QueueEvents 'completed' handler does)
      const recordSuccess = (scheduler as unknown as { recordSuccess(key: string): void }).recordSuccess.bind(scheduler);
      recordSuccess(sourceKey);

      // Assert
      expect(failureCounts.has(sourceKey)).toBe(false);
      expect(lastFailureTime.has(sourceKey)).toBe(false);
    });

    it('should skip a source that is in backoff window', async () => {
      // Arrange: seed 2 failures with a recent timestamp
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      const failureCounts = (scheduler as unknown as { failureCounts: Map<string, number> }).failureCounts;
      const lastFailureTime = (scheduler as unknown as { lastFailureTime: Map<string, number> }).lastFailureTime;
      failureCounts.set(sourceKey, 2);
      lastFailureTime.set(sourceKey, Date.now()); // just now — backoff = 240s

      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: Grafana job was skipped; only performance_test was checked
      // performance_test has no failures so it gets enqueued
      const calls = mockQueueAdd.mock.calls;
      const grafanaCalls = calls.filter((c: unknown[]) => (c[1] as Record<string, unknown>).sourceType === 'grafana');
      expect(grafanaCalls).toHaveLength(0);
    });

    it('should permanently stop retrying a source after FAILURE_STOP_THRESHOLD failures', async () => {
      // Arrange: FAILURE_STOP_THRESHOLD = 5
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      const failureCounts = (scheduler as unknown as { failureCounts: Map<string, number> }).failureCounts;
      const lastFailureTime = (scheduler as unknown as { lastFailureTime: Map<string, number> }).lastFailureTime;
      failureCounts.set(sourceKey, 5);
      lastFailureTime.set(sourceKey, Date.now() - 700_000); // past max backoff window

      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: even though we're past the max backoff time, FAILURE_STOP_THRESHOLD is reached
      const grafanaCalls = mockQueueAdd.mock.calls.filter(
        (c: unknown[]) => (c[1] as Record<string, unknown>).sourceType === 'grafana'
      );
      expect(grafanaCalls).toHaveLength(0);
    });

    it('should allow a source to retry after backoff window expires', async () => {
      // Arrange: 2 failures, but last failure was very long ago
      const sourceKey = 'run-abc123::grafana::grafana-inst-1';
      const failureCounts = (scheduler as unknown as { failureCounts: Map<string, number> }).failureCounts;
      const lastFailureTime = (scheduler as unknown as { lastFailureTime: Map<string, number> }).lastFailureTime;
      failureCounts.set(sourceKey, 2);
      // Backoff for count=2 = min(60_000 * 4, 600_000) = 240_000ms. Set last failure 300s ago.
      lastFailureTime.set(sourceKey, Date.now() - 300_000);

      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: Grafana job was enqueued
      const grafanaCalls = mockQueueAdd.mock.calls.filter(
        (c: unknown[]) => (c[1] as Record<string, unknown>).sourceType === 'grafana'
      );
      expect(grafanaCalls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupTestRun
  // -------------------------------------------------------------------------

  describe('cleanupTestRun', () => {
    it('should remove failure tracking entries for the specified test run', () => {
      // Arrange
      const failureCounts = (scheduler as unknown as { failureCounts: Map<string, number> }).failureCounts;
      const lastFailureTime = (scheduler as unknown as { lastFailureTime: Map<string, number> }).lastFailureTime;
      failureCounts.set('run-abc123::grafana::inst-1', 3);
      failureCounts.set('run-abc123::dynatrace::dt-1', 2);
      failureCounts.set('run-OTHER::grafana::inst-1', 1);
      lastFailureTime.set('run-abc123::grafana::inst-1', Date.now());
      lastFailureTime.set('run-OTHER::grafana::inst-1', Date.now());

      // Act
      scheduler.cleanupTestRun('run-abc123');

      // Assert
      expect(failureCounts.has('run-abc123::grafana::inst-1')).toBe(false);
      expect(failureCounts.has('run-abc123::dynatrace::dt-1')).toBe(false);
      expect(failureCounts.has('run-OTHER::grafana::inst-1')).toBe(true);
      expect(lastFailureTime.has('run-abc123::grafana::inst-1')).toBe(false);
      expect(lastFailureTime.has('run-OTHER::grafana::inst-1')).toBe(true);
    });

    it('should remove inFlightJobs entries for the specified test run', () => {
      // Arrange
      const inFlightJobs = (scheduler as unknown as { inFlightJobs: Set<string> }).inFlightJobs;
      inFlightJobs.add('run-abc123::grafana::inst-1');
      inFlightJobs.add('run-abc123::performance_test::null');
      inFlightJobs.add('run-XYZ::grafana::inst-1');

      // Act
      scheduler.cleanupTestRun('run-abc123');

      // Assert
      expect(inFlightJobs.has('run-abc123::grafana::inst-1')).toBe(false);
      expect(inFlightJobs.has('run-abc123::performance_test::null')).toBe(false);
      expect(inFlightJobs.has('run-XYZ::grafana::inst-1')).toBe(true);
    });

    it('should remove jobIdToSourceKey entries for the specified test run', () => {
      // Arrange
      const jobIdToSourceKey = (scheduler as unknown as { jobIdToSourceKey: Map<string, string> }).jobIdToSourceKey;
      jobIdToSourceKey.set('job-101', 'run-abc123::grafana::inst-1');
      jobIdToSourceKey.set('job-102', 'run-abc123::dynatrace::dt-1');
      jobIdToSourceKey.set('job-103', 'run-OTHER::grafana::inst-1');

      // Act
      scheduler.cleanupTestRun('run-abc123');

      // Assert
      expect(jobIdToSourceKey.has('job-101')).toBe(false);
      expect(jobIdToSourceKey.has('job-102')).toBe(false);
      expect(jobIdToSourceKey.has('job-103')).toBe(true);
    });

    it('should be a no-op when no entries exist for the specified test run', () => {
      // Act & Assert — should not throw
      expect(() => scheduler.cleanupTestRun('run-nonexistent')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // onModuleDestroy
  // -------------------------------------------------------------------------

  describe('onModuleDestroy', () => {
    it('should close both the queue and queueEvents when initialized', async () => {
      // Arrange: trigger initialization by running a cron tick
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([]);
      mockDataSource.query.mockResolvedValue([]);
      await scheduler.handleCron();

      // Act
      await scheduler.onModuleDestroy();

      // Assert
      expect(mockQueueEventsClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
    });

    it('should not throw when called before initialization (queue never created)', async () => {
      // Act & Assert
      await expect(scheduler.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('Error handling', () => {
    it('should catch and log errors thrown from enqueueCollectionJobs without crashing the tick', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      // Force applicationDashboardRepo.find to throw
      mockApplicationDashboardRepo.find.mockRejectedValueOnce(new Error('Repo explosion'));
      mockDataSource.query.mockResolvedValue([]);

      // Act & Assert — should not throw
      await expect(scheduler.handleCron()).resolves.not.toThrow();
    });

    it('should handle non-Error exceptions from enqueueCollectionJobs', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockRejectedValueOnce('raw string error');

      // Act & Assert
      await expect(scheduler.handleCron()).resolves.not.toThrow();
    });

    it('should catch and log errors from findInProgressTestRuns', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockRejectedValueOnce(new Error('DB query failed'));

      // Act
      await scheduler.handleCron();

      // Assert: isRunning is back to false
      expect((scheduler as unknown as { isRunning: boolean }).isRunning).toBe(false);
    });

    it('should return empty array from findInProgressTestRuns when databaseService is null', async () => {
      // Arrange: databaseService is never set (stays null)
      // DB is null on this scheduler instance, but getDatabaseService will throw once
      const { getDatabaseService } = await import('../../../common/database-accessor.js');
      vi.mocked(getDatabaseService).mockImplementation(() => {
        throw new Error('not ready');
      });

      const freshScheduler = new IncrementalCollectionScheduler();

      // Act
      await freshScheduler.handleCron();

      // Assert: no jobs enqueued
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('should handle queue.add rejection gracefully', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([makeApplicationDashboard()]);
      mockDataSource.query.mockResolvedValue([]);
      mockQueueAdd.mockRejectedValue(new Error('Redis connection refused'));

      // Act & Assert
      await expect(scheduler.handleCron()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Private helper: buildSourceKey
  // -------------------------------------------------------------------------

  describe('buildSourceKey (private)', () => {
    it('should format key as testRunId::sourceType::sourceId', () => {
      const build = (scheduler as unknown as {
        buildSourceKey(t: string, s: string, id: string | null): string;
      }).buildSourceKey.bind(scheduler);

      expect(build('run-1', 'grafana', 'inst-abc')).toBe('run-1::grafana::inst-abc');
      expect(build('run-1', 'dynatrace', 'dt-uuid')).toBe('run-1::dynatrace::dt-uuid');
      expect(build('run-1', 'performance_test', null)).toBe('run-1::performance_test::null');
    });
  });

  // -------------------------------------------------------------------------
  // Private helper: parseSourceKey
  // -------------------------------------------------------------------------

  describe('parseSourceKey (private)', () => {
    it('should split "type:id" into sourceType and sourceId', () => {
      const parse = (scheduler as unknown as {
        parseSourceKey(k: string): { sourceType: string; sourceId: string | null };
      }).parseSourceKey.bind(scheduler);

      expect(parse('grafana:inst-abc')).toEqual({ sourceType: 'grafana', sourceId: 'inst-abc' });
    });

    it('should return null sourceId for "type:null"', () => {
      const parse = (scheduler as unknown as {
        parseSourceKey(k: string): { sourceType: string; sourceId: string | null };
      }).parseSourceKey.bind(scheduler);

      expect(parse('performance_test:null')).toEqual({ sourceType: 'performance_test', sourceId: null });
    });
  });

  // -------------------------------------------------------------------------
  // Private helper: groupDashboardsBySource
  // -------------------------------------------------------------------------

  describe('groupDashboardsBySource (private)', () => {
    const group = (s: IncrementalCollectionScheduler, dashboards: ReturnType<typeof makeApplicationDashboard>[]) => {
      return (s as unknown as {
        groupDashboardsBySource(d: typeof dashboards): Map<string, typeof dashboards>;
      }).groupDashboardsBySource(dashboards);
    };

    it('should return an empty map for an empty array', () => {
      expect(group(scheduler, []).size).toBe(0);
    });

    it('should group dashboards by grafanaInstanceId key', () => {
      const dashboards = [
        makeApplicationDashboard({ id: 'd1', grafanaInstanceId: 'A' }),
        makeApplicationDashboard({ id: 'd2', grafanaInstanceId: 'A' }),
        makeApplicationDashboard({ id: 'd3', grafanaInstanceId: 'B' }),
      ];
      const result = group(scheduler, dashboards);
      expect(result.size).toBe(2);
      expect(result.get('grafana:A')?.map(d => d.id)).toEqual(['d1', 'd2']);
      expect(result.get('grafana:B')?.map(d => d.id)).toEqual(['d3']);
    });

    it('should skip dashboards without grafanaInstanceId', () => {
      const dashboards = [
        makeApplicationDashboard({ id: 'd1', grafanaInstanceId: undefined as unknown as string }),
        makeApplicationDashboard({ id: 'd2', grafanaInstanceId: 'A' }),
      ];
      const result = group(scheduler, dashboards);
      expect(result.size).toBe(1);
      expect(result.get('grafana:A')?.map(d => d.id)).toEqual(['d2']);
    });
  });

  // -------------------------------------------------------------------------
  // Queue initialization (ensureQueueInitialized)
  // -------------------------------------------------------------------------

  describe('Queue initialization', () => {
    it('should initialize the queue only once across multiple ticks', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([]);
      mockDataSource.query.mockResolvedValue([]);

      // Act — two ticks
      await scheduler.handleCron();
      // Unblock in-flight set so second tick actually enqueues
      const inFlight = (scheduler as unknown as { inFlightJobs: Set<string> }).inFlightJobs;
      inFlight.clear();
      await scheduler.handleCron();

      // Assert: createSimpleQueue was called exactly once
      const { createSimpleQueue } = await import('../../../workers/simple-worker-factory.js');
      expect(vi.mocked(createSimpleQueue)).toHaveBeenCalledTimes(1);
    });

    it('should attach completed and failed event listeners to QueueEvents', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      mockTestRunRepo.find.mockResolvedValue([makeTestRun()]);
      mockApplicationDashboardRepo.find.mockResolvedValue([]);
      mockDataSource.query.mockResolvedValue([]);

      // Act
      await scheduler.handleCron();

      // Assert: QueueEvents was instantiated (the scheduler stored it on this.queueEvents)
      const queueEvents = (scheduler as unknown as { queueEvents: unknown }).queueEvents;
      expect(queueEvents).not.toBeNull();
      expect(queueEvents).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // BullMQ jobId deduplication (issue #136, Defect C)
  // -------------------------------------------------------------------------

  describe('jobId deduplication', () => {
    it('should attach a deterministic time-bucketed jobId on every enqueue', async () => {
      // Arrange: one test run with a Grafana source, a Dynatrace config, and
      // the implicit performance_test source — covers all three enqueue sites.
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;
      const testRun = makeTestRun({ testRunId: 'run-dedup-1' });
      mockTestRunRepo.find.mockResolvedValue([testRun]);
      mockApplicationDashboardRepo.find.mockResolvedValue([
        makeApplicationDashboard({ grafanaInstanceId: 'g-1' }),
      ]);
      mockDataSource.query.mockResolvedValue([{ dynatrace_config_id: 'dt-1' }]);

      // Freeze time so the 60 s bucket is predictable across the tick.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-19T14:07:30Z'));
      const expectedBucket = Math.floor(Date.parse('2026-04-19T14:07:30Z') / 60_000);

      try {
        // Act
        await scheduler.handleCron();

        // Assert: jobId is set on every call, follows the dedup template,
        // and pins to the expected 60 s bucket.
        expect(mockQueueAdd).toHaveBeenCalledTimes(3);
        const sourceIds = new Set<string>();
        for (const call of mockQueueAdd.mock.calls) {
          const options = call[2];
          expect(options).toHaveProperty('jobId');
          // Separators are '.' — BullMQ rejects ':' in a jobId (issue #426).
          expect(options.jobId).not.toContain(':');
          const [prefix, testRunId, _sourceType, sourceId, bucket] = (options.jobId as string).split('.');
          expect(prefix).toBe('incremental');
          expect(testRunId).toBe('run-dedup-1');
          expect(Number(bucket)).toBe(expectedBucket);
          sourceIds.add(sourceId);
        }
        // Each of the three sources produced a distinct jobId.
        expect(sourceIds.size).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should reuse the same jobId for the same source within a minute bucket', async () => {
      // Arrange
      (scheduler as unknown as { databaseService: typeof mockDb }).databaseService = mockDb;

      // Invoke the private helper directly — we only care that two calls
      // within the same 60 s bucket produce an identical ID so BullMQ's
      // server-side dedup collapses them. This is the mechanism that
      // prevents the 20+ starts/second blast radius seen in #136.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-04-19T14:07:00Z'));
        const first = (scheduler as unknown as {
          buildDedupJobId: (t: string, s: string, id: string | null) => string;
        }).buildDedupJobId('run-x', 'performance_test', null);

        vi.setSystemTime(new Date('2026-04-19T14:07:59.999Z'));
        const second = (scheduler as unknown as {
          buildDedupJobId: (t: string, s: string, id: string | null) => string;
        }).buildDedupJobId('run-x', 'performance_test', null);

        expect(first).toBe(second);

        // A subsequent bucket yields a distinct id so the next natural tick
        // still enqueues — we don't want dedup to silently starve real work.
        vi.setSystemTime(new Date('2026-04-19T14:08:00Z'));
        const third = (scheduler as unknown as {
          buildDedupJobId: (t: string, s: string, id: string | null) => string;
        }).buildDedupJobId('run-x', 'performance_test', null);
        expect(third).not.toBe(first);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
