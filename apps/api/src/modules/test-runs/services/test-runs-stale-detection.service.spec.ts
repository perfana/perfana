import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TestRunsStaleDetectionService } from './test-runs-stale-detection.service';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuthorizationService } from '../../../common/services/authorization.service';

/**
 * Regression guard for #584.
 *
 * Stale detection used to publish `analyzeTestRun` to `perfana-jobs`, a queue with no
 * consumer anywhere in the monorepo — the worker only registers `perfana-analyze` and
 * `perfana-batch`. Every run completed by stale detection rather than by a clean
 * completion POST was therefore silently never analysed, behind a queue that only grew.
 *
 * These tests pin the enqueue to the same call the normal-completion path makes, so a
 * future change back to a bespoke queue name fails here instead of in production.
 *
 * withRequestEm() falls back to the plain repository outside an HTTP request, so the
 * service can be constructed directly with mocked collaborators.
 */
describe('TestRunsStaleDetectionService', () => {
  const staleRun = {
    id: 'uuid-1',
    testRunId: 'SONAR-acceptatie-loadtest_perfana-00010',
    systemUnderTestId: 'sut-1',
    testEnvironment: 'acceptatie',
    workload: 'loadtest_perfana',
    startTime: new Date('2026-09-10T03:03:05.605Z'),
    endTime: new Date('2026-09-10T06:05:35.808Z'),
    updatedAt: new Date('2026-09-10T06:05:35.808Z'),
  } as unknown as TestRunEntity;

  let repo: jest.Mocked<Repository<TestRunEntity>>;
  let bullmq: { analyzeTest: jest.Mock };
  let gateway: { emitTestRunUpdated: jest.Mock };
  let service: TestRunsStaleDetectionService;

  const build = () => {
    repo = {
      find: jest.fn().mockResolvedValue([staleRun]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Repository<TestRunEntity>>;

    bullmq = { analyzeTest: jest.fn().mockResolvedValue({ success: true, jobId: 'analyze-1' }) };
    gateway = { emitTestRunUpdated: jest.fn() };

    service = new TestRunsStaleDetectionService(
      repo,
      bullmq as unknown as BullMQClientService,
      { get: jest.fn().mockReturnValue(2) } as unknown as ConfigService,
      gateway as unknown as TestRunsGateway,
      {} as unknown as AuthorizationService,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    build();
  });

  it('enqueues analysis on the queue the worker consumes, with the completion path options', async () => {
    const marked = await service.detectAndMarkStaleTestRuns();

    expect(marked).toEqual(['SONAR-acceptatie-loadtest_perfana-00010']);
    expect(bullmq.analyzeTest).toHaveBeenCalledTimes(1);
    expect(bullmq.analyzeTest).toHaveBeenCalledWith('SONAR-acceptatie-loadtest_perfana-00010', {
      adapt: true,
      benchmarksOnly: false,
    });
  });

  it('passes the canonical test_run_id, never the uuid', async () => {
    await service.detectAndMarkStaleTestRuns();

    const [firstArg] = bullmq.analyzeTest.mock.calls[0];
    expect(firstArg).toBe('SONAR-acceptatie-loadtest_perfana-00010');
    expect(firstArg).not.toBe('uuid-1');
  });

  it('still marks the run stale when the enqueue fails', async () => {
    // The run must not be left un-completed because Redis was down; the enqueue error is
    // logged and swallowed, matching handleCompletedTest().
    bullmq.analyzeTest.mockRejectedValue(new Error('Redis unavailable'));

    await expect(service.detectAndMarkStaleTestRuns()).resolves.toEqual([
      'SONAR-acceptatie-loadtest_perfana-00010',
    ]);
    expect(repo.update).toHaveBeenCalledWith(
      'uuid-1',
      expect.objectContaining({ isStale: true, completed: true }),
    );
  });

  it('enqueues nothing when no run is stale', async () => {
    repo.find.mockResolvedValue([]);

    await expect(service.detectAndMarkStaleTestRuns()).resolves.toEqual([]);
    expect(bullmq.analyzeTest).not.toHaveBeenCalled();
  });
});
