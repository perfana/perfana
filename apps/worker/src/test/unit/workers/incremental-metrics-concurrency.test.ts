import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { incrementalMetricsWorker } from '../../../workers/incremental-metrics.js';

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
}));

vi.mock('../../../nestjs-bootstrap.js', () => ({
  bootstrapNestJS: vi.fn(),
  getService: vi.fn(),
}));

const mockUpdateCollectedRanges = vi.fn().mockResolvedValue(undefined);
const mockRecordFailedRange = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => ({
    updateCollectedRanges: mockUpdateCollectedRanges,
    recordFailedRange: mockRecordFailedRange,
  })),
}));

vi.mock('../../../config/redis-pool.js', () => ({
  acquireRedisConnection: vi.fn().mockResolvedValue({}),
  releaseRedisConnection: vi.fn(),
}));

const mockPipelineExecute = vi.fn();
vi.mock('../../../pipelines/IncrementalMetricsPipeline.js', () => ({
  IncrementalMetricsPipeline: vi.fn().mockImplementation(() => ({
    execute: mockPipelineExecute,
  })),
}));

const mockAcquireKeyLock = vi.fn();
const mockReleaseKeyLock = vi.fn().mockResolvedValue(true);
vi.mock('../../../services/JobLockService.js', () => ({
  JobLockService: vi.fn().mockImplementation(() => ({
    acquireKeyLock: mockAcquireKeyLock,
    releaseKeyLock: mockReleaseKeyLock,
  })),
}));

function makePerfTestJob(overrides: Partial<Record<string, unknown>> = {}): Job {
  const data = {
    testRunId: 'tr-001',
    sourceType: 'performance_test',
    sourceId: null,
    applicationDashboardIds: [],
    fromTime: new Date('2026-04-19T11:00:00Z').toISOString(),
    toTime: new Date('2026-04-19T11:01:00Z').toISOString(),
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  };
  return { id: 'bullmq-job-id-1', data } as unknown as Job;
}

describe('incrementalMetricsWorker — performance_test concurrency guard (issue #134)', () => {
  let worker: ReturnType<typeof incrementalMetricsWorker>;

  beforeEach(() => {
    vi.clearAllMocks();
    worker = incrementalMetricsWorker();
  });

  it('runs the pipeline when the per-test_run_id lock is acquired', async () => {
    mockAcquireKeyLock.mockResolvedValue(true);
    mockPipelineExecute.mockResolvedValue({
      success: true,
      data: { performanceTest: { dataPoints: 42 } },
    });

    const result = await worker(makePerfTestJob());

    expect(mockAcquireKeyLock).toHaveBeenCalledWith(
      'job:lock:perf-test-metrics:tr-001',
      'bullmq-job-id-1',
      expect.any(Number)
    );
    expect(mockPipelineExecute).toHaveBeenCalledTimes(1);
    expect(mockReleaseKeyLock).toHaveBeenCalledWith(
      'job:lock:perf-test-metrics:tr-001',
      'bullmq-job-id-1'
    );
    expect(result.status).toBe('success');
  });

  it('skips the pipeline (no DELETE/INSERT race) when another tick already holds the lock', async () => {
    mockAcquireKeyLock.mockResolvedValue(false);
    const fromTime = new Date('2026-04-19T11:00:00Z').toISOString();

    const result = await worker(makePerfTestJob({ fromTime }));

    // Critical: the pipeline must NOT execute when the lock is held — that is
    // exactly the overlap that triggered the duplicate-key race.
    expect(mockPipelineExecute).not.toHaveBeenCalled();
    // Must NOT release a lock we never acquired.
    expect(mockReleaseKeyLock).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    // Load-bearing assertion: the collected range must NOT advance on a skip.
    // Returning dataPoints: 0 makes effectiveToTime === fromTime so the next
    // scheduler tick re-attempts the same window. A regression here would
    // silently lose data without any other test failing.
    expect(mockUpdateCollectedRanges).toHaveBeenCalledWith(
      'tr-001',
      'performance_test',
      null,
      expect.objectContaining({
        from: new Date(fromTime),
        to: new Date(fromTime),
      })
    );
  });

  it('releases the lock even when the pipeline throws', async () => {
    mockAcquireKeyLock.mockResolvedValue(true);
    mockPipelineExecute.mockRejectedValue(new Error('boom'));

    await worker(makePerfTestJob());

    expect(mockReleaseKeyLock).toHaveBeenCalledWith(
      'job:lock:perf-test-metrics:tr-001',
      'bullmq-job-id-1'
    );
  });
});
